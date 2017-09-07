const pg = require('pg');

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
    return other;
  }

  or(other) {
    this.adjoined.push({
      conj: 'OR',
      obj: other,
    });
    return other;
  }

  compile() {
    let strVal = `&$${this.operator}$&$`;
    const params = [this.key, this.value];
    for (const adjoined of this.adjoined) {
      const compiled = adjoined.compile();
      if (adjoined.obj.adjoined.length > 0) {
        strVal += ` ${adjoined.conj} (${compiled.strVal})`;
      } else {
        strVal += ` ${adjoined.conj} ${compiled.strVal}}`;
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
    let query = `SELECT ${this.fields.map((f, i) => `$${i}`).join(', ')}` +
        ` FROM ${this.table.name}`;
    if (this.predicate) {
      const compiled = this.predicate.compile();
      for (const param of compiled) {
        this.fields.push(param);
      }
      let i = this.fields.length + 1;
      compiled.strVal = compiled.strVal.replace('&$', () => i++);
      query += ` WHERE ${compiled.strVal}`;
    }
    return this.table.db.query(query, this.fields);
  }
}

class Table {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  select(fields) {
    return new QueryBuilder(
      this, Array.isArray(fields) ? fields : [fields]));
  }

  insert(values) {
    return this.db.query(`INSERT INTO ${this.name}` +
      ` VALUES(${values.map((p, i) => `$${i}`).join(', ')})`, values);
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
