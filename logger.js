const bunyan = require('bunyan');

const logger = bunyan.createLogger({
  name: app.name,
});

module.exports = logger;