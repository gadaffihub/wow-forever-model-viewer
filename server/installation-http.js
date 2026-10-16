'use strict';
const {saveInstallation} = require('./installation');

async function configureInstallation(req, settingsPath) {
  // Only the viewer's own page can write its local installation setting.
  if (req.headers.origin !== `http://${req.headers.host}`) throw Object.assign(new Error('Open Settings from the local viewer.'), {status: 403});
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw Object.assign(new Error('Expected JSON settings.'), {status: 415});
  const chunks = [];let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw Object.assign(new Error('Installation path is too long.'), {status: 413});
    chunks.push(chunk);
  }
  let input;
  try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw Object.assign(new Error('Invalid settings request.'), {status: 400});}
  return saveInstallation(input?.path, settingsPath);
}

module.exports = {configureInstallation};
