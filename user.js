const db = require('./database');
const {Note, NoteSet} = require('./note');

const userCache = new Map();
const userCacheByGid = new Map();

class User {
  constructor(id) {
    this.id = id;
    this.name = null;
    this.email = null;
    this.gid = null;
  }

  async getNotes(predicates, offset) {
    const query = db.tables.notes.select('*').limit(16);
    const predicate = new db.Predicate('owner', '=', this.id);
    for (const paramPred of predicates) {
      predicate.and(paramPred);
    }
    if (offset) {
      query.offset(offset);
    }
    const result = await query.where(predicate).execute();
    return result.rows.map((row) => new Note(row));
  }

  async postNote(body, set) {
    const id = await Note.getNextId();
    const timestamp = new Date();
    await db.tables.notes.insert([
      id, this.id,
      !!set ? set.id : -1,
      timestamp, body, false,
    ]);
    return new Note({
      id: id, owner: this.id, set: !!set ? set.id : null,
      timestamp: timestamp, body: body, marked: false,
    });
  }

  async getNoteSets(offset) {
    const query = db.tables.sets.select('*').limit(16);
    if (offset) {
      query.offset(offset);
    }
    const result = await query.execute();
    return result.rows.map((row) => new NoteSet(row));
  }

  async createSet(name, type) {
    const id = await NoteSet.getNextId();
    await db.tables.sets.insert([
      id, this.id, name, type,
    ]);
    return new NoteSet({
      id: id, owner: this.id, name: name, type: type,
    });
  }

  static async getNextId() {
    return (await db.tables.users.select('COALESCE(MAX(id), -1)').execute())
      .rows[0].coalesce + 1;
  }

  static async createOrGet(params) {
    let cached = userCacheByGid.get(params.gid);
    if (cached) {
      return cached;
    }
    const result = await db.tables.users.select('*')
      .where(new db.Predicate('gid', '=', params.gid.toString()))
      .execute();
    if (result.rowCount !== 0) {
      const row = result.rows[0];
      const user = new User(row.id);
      user.name = row.name;
      user.email = row.email;
      user.gid = row.gid;
      userCache.set(row.id, user);
      userCacheByGid.set(row.gid, user);
      return user;
    }
    const id = await User.getNextId();
    await db.tables.users.insert([id, params.name, params.email, params.gid]);
    const user = new User(id);
    user.name = params.name;
    user.email = params.email;
    user.gid = params.gid;
    userCache.set(user.id, user);
    userCacheByGid.set(user.gid, user);
    return user;
  }

  static async resolve0(id) {
    const result = await db.tables.users.select('*')
      .where(new db.Predicate('id', '=', id))
      .execute();
    if (result.rowCount === 0) {
      return null;
    }
    const row = result.rows[0];
    const user = new User(row.id);
    user.name = row.name;
    user.email = row.email;
    user.gid = row.gid;
    userCache.set(row.id, user);
    userCacheByGid.set(row.gid, user);
    return user;
  }

  static async resolve(id) {
    const cached = userCache.get(id);
    return !cached ? User.resolve0(id) : cached;
  }
}

module.exports = User;
