const db = require('./database');

class Note {
  constructor(params) {
    this.id = params.id;
    this.owner = params.owner;
    this.set = params.set || null;
    this.timestamp = params.timestamp;
    this.body = params.body;
    this.marked = params.marked;
  }

  async edit(fields) {
    return db.tables.notes.update(new db.Predicate('id', '=', this.id), fields);
  }

  async delete() {
    return db.tables.notes.delete(new db.Predicate('id', '=', this.id));
  }

  serialize() {
    return {
      id: this.id,
      owner: this.owner,
      set: this.set,
      timestamp: this.timestamp,
      body: this.body,
      marked: this.marked,
    };
  }

  static async getNote(id) {
    const result = await db.tables.notes.select('*')
      .where(new db.Predicate('id', '=', id))
      .execute();
    return result.rowCount > 0 ? new Note(result.rows[0]) : null;
  }

  static async getNextId() {
    return (await db.tables.notes.select('COALESCE(MAX(id), -1)').execute())
      .rows[0].coalesce + 1;
  }
}

class NoteSet {
  constructor(params) {
    this.id = params.id;
    this.owner = params.owner;
    this.name = params.name;
    this.type = params.type;
  }

  async edit(fields) {
    return db.tables.sets.update(new db.Predicate('id', '=', this.id), fields);
  }

  async delete() {
    return (async () => {
      await db.tables.notes.delete(new db.Predicate('set', '=', this.id));
      await db.tables.sets.delete(new db.Predicate('id', '=', this.id));
    })();
  }

  async getNotes() {
    const results = await db.tables.notes.select('*')
      .where(new db.Predicate('set', '=', this.id))
      .execute();
    return results.rows.map((row) => new Note(row));
  }

  serialize() {
    return {
      id: this.id,
      owner: this.owner,
      name: this.name,
      type: this.type,
    };
  }

  static async getSet(id) {
    const result = await db.tables.sets.select('*')
      .where(new db.Predicate('id', '=', id))
      .execute();
    return result.rowCount > 0 ? new NoteSet(result.rows[0]) : null;
  }

  static async getNextId() {
    return (await db.tables.sets.select('COALESCE(MAX(id), -1)').execute())
      .rows[0].coalesce + 1;
  }
}

module.exports = {
  Note: Note,
  NoteSet: NoteSet,
};
