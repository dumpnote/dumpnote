const restify = require('restify');
const sessions = require('client-sessions');
const passport = require('passport-restify');
const GoogleStrategy = require('passport-google-oauth20');
const logger = require('./logger');
const User = require('./user');
const {NoteSet, Note} = require('./note');
const {db, Predicate} = require('./database');

/*
 * app constants and logger
 */
const app = {
  name: 'dumpnote',
};

/*
 * configure server
 */
const server = restify.createServer({
  name: app.name,
  log: logger,
});

server.use(sessions({
  cookieName: 'session',
  secret: process.env.DN_SESS_SECRET,
  duration: 7 * 24 * 60 * 60 * 1000,
  activeDuration: 7 * 24 * 60 * 1000,
}));
server.use(passport.initialize());
server.use(passport.session());
server.use((req, res, next) => {
  console.log('Req: ' + req.httpVersion + ' ' + req.method + ' ' + req.url);
  res.setHeader('content-type', 'application/json');
  return next();
});
server.use(restify.plugins.queryParser());

/*
 * configure passport
 */
passport.use(new GoogleStrategy({
  clientID: process.env.DN_GOOG_CID,
  clientSecret: process.env.DN_GOOG_SECRET,
  callbackURL: process.env.DN_GOOG_CB,
}, async (accessToken, refreshToken, profile, done) => {
  const user = await User.createOrGet({
    gid: profile.id,
    name: profile.displayName,
    email: profile.emails[0].value,
  });
  done(null, user);
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.resolve(id);
  done(null, user);
});

/*
 * util endpoints
 */
server.get('/ping', (req, res) => res.send(200));

/*
 * auth endpoints
 */
server.get('/auth',
  passport.authenticate('google', {scope: ['email profile']}));
server.get('/authcb',
  passport.authenticate('google', {
    failureRedirect: '/auth',
    failureFlash: true,
  }), (req, res, next) => res.redirect(process.env.DN_AUTH_CB, next));

server.get('/authstatus', (req, res) =>
  res.send(200, {authed: req.isAuthenticated()}));

server.get('/unauth', (req, res) => {
  req.logout();
  res.send(200);
});

function mwAuthed(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.send(401, {error: 'Unauthenticated!'});
}

/*
 * note endpoints
 */
const singleCharOps = ['=', '>', '<'];
const twoCharOps = ['<>', '>=', '<='];
server.get('/notes', mwAuthed, (req, res) => {
  const predicates = [];
  function tryAdd(param) {
    if (req.query[param]) {
      let operator = null;
      if (twoCharOps.some((op) => req.query[param].startsWith(op))) {
        operator = req.query[param].substring(0, 2);
        if (operator === '!=') {
          operator = '<>';
        }
        req.query[param] = req.query[param].substring(2);
      } else if (singleCharOps.some((op) => req.query[param].startsWith(op))) {
        operator = req.query[param].substring(0, 1);
        req.query[param] = req.query[param].substring(1);
      } else {
        operator = '=';
      }
      predicates.push(new Predicate(param, operator, req.query[param]));
    }
  }
  function tryAddBool(param) {
    if (req.query[param]) {
      if (req.query[param] === 'true' || req.query[param] === 'false') {
        predicates.push(new Predicate(param, '=', req.query[param]));
      } else {
        res.send(400, {
          error: `Expected boolean at ${param}=${req.query[param]}`,
        });
        return;
      }
    }
  }
  tryAdd('id');
  tryAdd('set');
  tryAdd('timestamp');
  tryAddBool('marked');
  if (req.query.search) {
    predicates.push(
      new Predicate('body', ' LIKE ', `%${req.query.search}%`));
  }
  req.user.getNotes(predicates)
    .then((notes) => res.send(200, notes.map((note) => note.serialize())));
});
server.post('/notes', mwAuthed, (req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch (e) {
      res.send(400, {error: e.message});
      return;
    }
    const note = await req.user.postNote(body.body, body.set);
    res.send(200, note.serialize());
  });
});

server.get('/notes/:note', mwAuthed, async (req, res) => {
  const note = await Note.getNote(req.params.note);
  if (!note) {
    res.send(404, {error: 'Note not found!'});
  } else if (note.owner !== req.user.id) {
    res.send(403, {error: 'No permission!'});
  } else {
    res.send(200, note.serialize());
  }
});
server.del('/notes/:note', mwAuthed, async (req, res) => {
  const note = await Note.getNote(req.params.note);
  if (!note) {
    res.send(404, {error: 'Note not found!'});
  } else if (note.owner !== req.user.id) {
    res.send(403, {error: 'No permission!'});
  } else {
    await note.delete();
    res.send(200, note.serialize());
  }
});
server.patch('/notes/:note', mwAuthed, async (req, res) => {
  let note = await Note.getNote(req.params.note);
  if (!note) {
    res.send(404, {error: 'Note not found!'});
  } else if (note.owner !== req.user.id) {
    res.send(403, {error: 'No permission!'});
  } else {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch (e) {
        res.send(400, {error: e.message});
        return;
      }
      const fields = {};
      function tryAdd(name, type) {
        if (body.hasOwnProperty(name) && typeof(body[name]) === type) {
          fields[name] = body[name];
        }
      }
      tryAdd('set', 'number');
      tryAdd('body', 'string');
      tryAdd('marked', 'boolean');
      await note.edit(fields);
      note = await Note.getNote(note.id);
      res.send(200, note.serialize());
    });
  }
});

/*
 * set endpoints
 */
const noteSetTypes = ['daily', 'monthly', 'untimed'];
server.get('/sets', mwAuthed, (req, res) => {
  req.user.getNoteSets()
    .then((sets) => res.send(200, sets.map((s) => s.serialize())));
});
server.post('/sets', mwAuthed, (req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch (e) {
      res.send(400, {error: e.message});
      return;
    }
    const set = await req.user.createSet(body.name, body.type);
    res.send(200, set.serialize());
  });
});

server.get('/sets/:set', mwAuthed, async (req, res) => {
  const set = await NoteSet.getSet(req.params.set);
  if (!set) {
    res.send(404, {error: 'Set not found!'});
  } else if (set.owner !== req.user.id) {
    res.send(403, {error: 'No permission!'});
  } else {
    res.send(200, set.serialize());
  }
});
server.del('/sets/:set', mwAuthed, async (req, res) => {
  const set = await NoteSet.getSet(req.params.set);
  if (!set) {
    res.send(404, {error: 'Set not found!'});
  } else if (set.owner !== req.user.id) {
    res.send(403, {error: 'No permission!'});
  } else {
    await set.delete();
    res.send(200, set.serialize());
  }
});
server.patch('/sets/:set', mwAuthed, async (req, res) => {
  let set = await NoteSet.getSet(req.params.set);
  if (!set) {
    res.send(404, {error: 'Set not found!'});
  } else if (set.owner !== req.user.id) {
    res.send(403, {error: 'No permission!'});
  } else {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch (e) {
        res.send(400, {error: e.message});
        return;
      }
      const fields = {};
      function tryAdd(name, type) {
        if (body.hasOwnProperty(name) && typeof(body[name]) === type) {
          fields[name] = body[name];
        }
      }
      tryAdd('name', 'string');
      tryAdd('type', 'string');
      if (!!fields.type && !noteSetTypes.includes(fields.type)) {
        res.send(400, {error: 'Bad set type!'});
      } else {
        await set.edit(fields);
        set = await NoteSet.getSet(set.id);
        res.send(200, set.serialize());
      }
    });
  }
});

/*
 * start server
 */
(async () => {
  logger.info('initializing database connection.');
  try {
    await db.connect();
  } catch (err) {
    throw err;
  }
  logger.info('starting server.');
  await server.listen(process.env.PORT, () => logger.info('server started.'));
})();
