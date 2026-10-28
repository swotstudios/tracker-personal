// Controllo password condiviso dalle funzioni in api/ (i file che iniziano con _ non diventano endpoint)
const crypto = require('crypto');

const PASSWORD = process.env.TRACKER_PASSWORD;

function authorized(req) {
  if (!PASSWORD) return false;
  const given = Buffer.from(String(req.headers['x-tracker-key'] || ''));
  const expected = Buffer.from(PASSWORD);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = { PASSWORD, authorized };
