const pg = require('pg');
const logger = require('./logger');

pg.defaults.ssl = true;
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

class Predicate {
  constructor(key, operator, value) {
    this.key = key;
    this.operator = operator;
    this.value = value;
    this.adjoined = [];
  }

  and(other) {
    this.adjoined.push({
      conj: 'AND',
      obj: other,
    });
    return this;
  }

  or(other) {
    this.adjoined.push({
      conj: 'OR',
      obj: other,
    });
    return this;
  }

  compile() {
    let strVal = `${this.key}${this.operator}&$`;
    const params = [this.value];
    for (const adjoined of this.adjoined) {
      const compiled = adjoined.obj.compile();
      if (adjoined.obj.adjoined.length > 0) {
        strVal += ` ${adjoined.conj} (${compiled.strVal})`;
      } else {
        strVal += ` ${adjoined.conj} ${compiled.strVal}`;
      }
      for (const param of compiled.params) {
        params.push(param);
      }
    }
    return {
      strVal: strVal,
      params: params,
      source: this,
    };
  }
}

class QueryBuilder {
  constructor(table, fields) {
    this.table = table;
    this.fields = fields;
    this.predicate = null;
    this._limit = -1;
    this._offset = -1;
  }

  where(predicate) {
    this.predicate = predicate;
    return this;
  }

  limit(limit) {
    this._limit = limit;
    return this;
  }

  offset(offset) {
    this._offset = offset;
    return this;
  }

  execute() {
    let query = `SELECT ${this.fields.join(', ')} FROM ${this.table.name}`;
    const params = [];
    if (this.predicate) {
      const compiled = this.predicate.compile();
      let i = 1;
      for (const param of compiled.params) {
        params.push(param);
      }
      compiled.strVal = compiled.strVal.replace(/&\$/g, () => `$${i++}`);
      query += ` WHERE ${compiled.strVal}`;
    }
    if (this._limit > 0) {
      query += ` LIMIT ${this._limit}`;
      if (this._offset > 0) {
        query += ` OFFSET ${this._offset}`;
      }
    }
    logger.info(`Executing query ${query}` +
      ` with params ${JSON.stringify(params)}`);
    return this.table.db.query(query, params);
  }
}

class Table {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  select(fields) {
    return new QueryBuilder(
      this, Array.isArray(fields) ? fields : [fields]);
  }

  insert(values) {
    const query = `INSERT INTO ${this.name}` +
      ` VALUES (${values.map((p, i) => `$${i + 1}`).join(', ')})`;
    logger.info(`Executing query ${query}` +
      ` with params ${JSON.stringify(values)}`);
    return this.db.query(query, values);
  }

  update(predicate, fields) {
    const params = [];
    const fieldStrs = [];
    for (const field in fields) {
      if (fields.hasOwnProperty(field)) {
        params.push(fields[field]);
        fieldStrs.push(`${field}=&$`);
      }
    }
    const compiled = predicate.compile();
    for (const param of compiled.params) {
      params.push(param);
    }
    let i = 1;
    const query = (`UPDATE ${this.name} SET ${fieldStrs.join(', ')}` +
      ` WHERE ${compiled.strVal}`)
      .replace(/&\$/g, () => `$${i++}`);
    logger.info(`Executing query ${query}` +
      ` with params ${JSON.stringify(params)}`);
    return this.db.query(query, params);
  }

  delete(predicate) {
    const params = [];
    const compiled = predicate.compile();
    for (const param of compiled.params) {
      params.push(param);
    }
    let i = 1;
    compiled.strVal = compiled.strVal.replace(/&\$/g, () => `$${i++}`);
    const query = `DELETE FROM ${this.name} WHERE ${compiled.strVal}`;
    logger.info(`Executing query ${query}` +
      ` with params ${JSON.stringify(params)}`);
    return this.db.query(query, params);
  }
}

function getTable(name) {
  return new Table(db, name);
}

const tables = ['users', 'sets', 'notes'].reduce((acc, cur) => {
  acc[cur] = getTable(cur);
  return acc;
}, {});

module.exports = {
  Table: Table,
  QueryBuilder: QueryBuilder,
  Predicate: Predicate,
  tables: tables,
  db: db,
};
