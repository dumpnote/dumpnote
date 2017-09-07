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
    let strVal = `&$${this.operator}&$`;
    const params = [this.key, this.value];
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
  }

  where(predicate) {
    this.predicate = predicate;
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
    logger.info(`Executing query ${query} with params ${JSON.stringify(params)}`);
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
    logger.info(`Executing query ${query} with params ${JSON.stringify(values)}`);
    return this.db.query(query, values);
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
