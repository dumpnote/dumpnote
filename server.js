const restify = require('restify');
const passport = require('passport-restify');
const GoogleStrategy = require('passport-google-oauth20');
const logger = require('./logger');
const User = require('./user');
const db = require('./database').db;

/*
 * app constants and logger
 */
const app = {
  name: 'dumpnote',
};

/*
 * passport config
 */
passport.use(new GoogleStrategy({
  clientID: process.env.DN_GOOG_CID,
  clientSecret: process.env.DN_GOOG_SECRET,
  callbackURL: process.env.DN_GOOG_CB,
}, (accessToken, refreshToken, profile, cb) => User.createOrGet({
  gid: profile.id,
  name: profile.displayName,
  email: profile.emails[0].value,
}).then(cb)));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => User.resolve(id).then(done));

/*
 * configure server
 */
const server = restify.createServer({
  name: app.name,
  log: logger,
});

server.use((req, res, next) => {
  console.log('Req: ' + req.httpVersion + ' ' + req.method + ' ' + req.url);
  res.setHeader('content-type', 'application/json');
  return next();
});

server.use(restify.plugins.queryParser());

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
  }), (req, res) => res.redirect(process.env.DN_AUTH_CB));

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
      if (singleCharOps.some((op) => req.query[param].startsWith(op))) {
        operator = req.query[param].substring(0, 1);
        req.query[param] = req.query[param].substring(1);
      } else if (twoCharOps.some((op) => req.query[param].startsWith(op))) {
        operator = req.query[param].substring(0, 2);
        if (operator === '!=') {
          operator = '<>';
        }
        req.query[param] = req.query[param].substring(2);
      } else {
        operator = '=';
      }
      predicates.push(new db.Predicate(param, operator, req.query[param]));
    }
  }
  function tryAddBool(param) {
    if (req.query[param]) {
      if (req.query[param] === 'true' || req.query[param] === 'false') {
        predicates.push(new db.Predicate(param, '=', req.query[param]));
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
      new db.Predicate('body', ' LIKE ', `%${req.query.search}%`));
  }
  req.user.getNotes(predicates)
    .then((notes) => res.send(200, notes.map((note) => note.serialize())));
});
server.post('/notes', mwAuthed, (req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const note = await req.user.postNote(body.body, body.set);
    res.send(200, note);
  });
});

server.get('/notes/:note', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
});
server.del('/notes/:note', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
});
server.patch('/notes/:note', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
});

/*
 * set endpoints
 */
server.get('/sets', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
});
server.post('/sets', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
});

server.get('/sets/:set', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
});
server.del('/sets/:set', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
});
server.patch('/sets/:set', mwAuthed, (req, res) => {
  res.send(501, {error: 'Not implemented!'});
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
