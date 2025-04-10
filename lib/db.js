// sqlite3 async wrapper
const log = require("./logger");

function all(db, sql, params) {
  return new Promise(function (resolve, reject) {
    if (params == undefined) params = [];
    db.all(sql, params, function (err, rows) {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(db, sql, params) {
  return new Promise(function (resolve, reject) {
    if (params == undefined) params = [];
    log.debug("in sqliteRun, sql %s, values: %o", sql, params);
    db.run(sql, params, function (err, row) {
      if (err) {
        log.debug("in sqliteRun, err: %s", err);
        reject(err);
      } else {
        // per sqlite3 docs: https://github.com/TryGhost/node-sqlite3/wiki/API#runsql--param---callback
        // this.lastID - the row ID of the last row insert from this statement
        // this.changes - the number of rows affected by this statement
        // so we'll return the this object
        log.debug("in sqliteRun, success with stmt object this: %j", this);
        resolve(this);
      }
    });
  });
}

module.exports = {
  run,
  all,
};
