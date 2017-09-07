const bunyan = require('bunyan');

const logger = bunyan.createLogger({
  name: 'dumpnote',
});

module.exports = logger;
