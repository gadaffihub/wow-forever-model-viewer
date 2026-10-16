'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {parseArgs} = require('node:util');
const {Archive, ROOT} = require('./archive');
const {Catalog} = require('./catalog');
const {Metadata} = require('./metadata');
const {parseM2, parseWMO, animation} = require('./models');
const {decodeBLP, png} = require('./blp');
const {createAudioReader, sendAudio} = require('./audio');
const {loadSoundIndex} = require('./sounds');
const {configureInstallation} = require('./installation-http');
const {readSettings} = require('./installation');
const {values: options} = parseArgs({options: {'wow-path': {type: 'string'}, port: {type: 'string'}, help: {type: 'boolean'}}});
if (options.help) {console.log('npm start -- [--wow-path "/path/to/World of Warcraft"] [--port 4317]');process.exit(0);}
const PORT = Number(options.port || process.env.PORT || 4317);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('Port must be between 1 and 65535.');
const archive = new Archive(options['wow-path']);
const readAudio = createAudioReader(archive);
const models = new Map(), pending = new Map(), textures = new Map();
let catalog, metadata, initError, appVersion;
let soundLibrary;
const staticFiles = new Map();

async function loadAssets() {
  const digest = crypto.createHash('sha256');
  for (const name of ['index.html', 'app.js', 'style.css', 'catalog.mjs', 'settings.mjs']) {
    const data = await fs.readFile(path.join(ROOT, 'public', name));
    staticFiles.set('/' + name, data);digest.update(data);
  }
  for (const name of (await fs.readdir(path.join(ROOT,'server'))).filter(name=>name.endsWith('.js')).sort()) digest.update(await fs.readFile(path.join(ROOT,'server',name)));
  appVersion = digest.digest('hex').slice(0, 16);
  staticFiles.set('/index.html', Buffer.from(staticFiles.get('/index.html').toString().replace('{{APP_VERSION}}', appVersion)));
}
async function model(id) {
  if (!catalog.models.has(id)) throw Object.assign(new Error('This file is outside the selected model folders.'), {code: 'OUTSIDE_CATALOG'});
  if (models.has(id)) {const value = models.get(id);models.delete(id);models.set(id, value);return value;}
  if (pending.has(id)) return pending.get(id);
  const parse = catalog.models.get(id).type === 'wmo' ? parseWMO : parseM2;
  const promise = parse(archive, id).then(value => {models.set(id, value);while (models.size > 5) models.delete(models.keys().next().value);return value;});
  pending.set(id, promise);
  try {return await promise;} finally {pending.delete(id);}
}
async function texture(id) {
  const entry = archive.files.get(id);
  if (!entry?.local) throw new Error('Texture is not installed in this beta build.');
  const file = path.join(archive.cacheDir, `texture-${entry.contentKey}.png`);
  try {return await fs.readFile(file);} catch {}
  if (textures.has(id)) return textures.get(id);
  const promise = (async () => {
    const decoded = decodeBLP(await archive.getFile(id));
    const result = png(decoded.width, decoded.height, decoded.pixels);
    await fs.writeFile(file, result);return result;
  })();
  textures.set(id, promise);
  try {return await promise;} finally {textures.delete(id);}
}
function send(req, res, status, data, type = 'application/json') {
  let bytes = Buffer.isBuffer(data) ? data : Buffer.from(type === 'application/json' ? JSON.stringify(data) : data);
  const headers = {'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'};
  if (bytes.length > 2048 && req.headers['accept-encoding']?.includes('gzip') && type !== 'image/png') {bytes = zlib.gzipSync(bytes);headers['Content-Encoding'] = 'gzip';}
  res.writeHead(status, headers);res.end(req.method === 'HEAD' ? undefined : bytes);
}
const mime = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8'};
const server = http.createServer(async (req, res) => {
  try {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host || '').replace(/:\d+$/, ''))) return send(req, res, 403, {error: 'Local connections only'});
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`), route = url.pathname;
    if (req.method === 'POST' && route === '/api/installation') {
      const installation = await configureInstallation(req);
      return send(req, res, 200, {path: installation.path, version: installation.version, restartRequired: installation.path !== archive.build?.path, overridden: !!(options['wow-path'] || process.env.WOW_PATH)});
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(req, res, 405, {error: 'Unsupported method'});
    if (route === '/api/installation') return send(req, res, 200, {path: archive.build?.path || (await readSettings()).wowPath || '', version: archive.build?.version});
    if (route === '/api/status') return send(req, res, 200, {appVersion, ...(initError ? {phase: 'error', error: initError.message, code: initError.code} : catalog ? catalog.status() : archive.status)});
    if (route.startsWith('/api/')) {
      if (!catalog) return send(req, res, 503, {error: initError?.message || 'Opening the beta catalog.'});
      if (route === '/api/catalog') return send(req, res, 200, {appVersion, ...catalog.snapshot()});
      if (route === '/api/models') return send(req, res, 200, catalog.query(url.searchParams));
      if (route === '/api/sounds') {
        soundLibrary ||= loadSoundIndex(archive).catch(error => {soundLibrary = null;throw error;});
        return send(req, res, 200, {...await soundLibrary, build: archive.build, revision: catalog.revision});
      }
      let match = route.match(/^\/api\/model\/(\d+)\/info$/);
      if (match) return send(req, res, 200, await metadata.get(Number(match[1])));
      match = route.match(/^\/api\/model\/(\d+)$/);
      if (match) {
        const id = Number(match[1]), {source, ...data} = await model(id);
        return send(req, res, 200, {...data, textures: data.textures.map(texture=>({...texture,path:archive.names.get(texture.id)||null})), entry: catalog.models.get(id), appearances: catalog.appearances.get(id) || [], build: archive.build, revision: catalog.revision});
      }
      match = route.match(/^\/api\/animation\/(\d+)\/(\d+)$/);
      if (match) return send(req, res, 200, await animation(archive, await model(Number(match[1])), Number(match[2])));
      match = route.match(/^\/api\/texture\/(\d+)\.png$/);
      if (match) return send(req, res, 200, await texture(Number(match[1])), 'image/png');
      match = route.match(/^\/api\/sound\/(\d+)$/);
      if (match) return sendAudio(req, res, await readAudio(Number(match[1]), {wav: url.searchParams.get('format') === 'wav'}));
      return send(req, res, 404, {error: 'Unknown API route'});
    }
    const resource = route === '/' ? '/index.html' : route;
    if (staticFiles.has(resource)) return send(req, res, 200, staticFiles.get(resource), mime[path.extname(resource)]);
    if (route.startsWith('/three/')) {
      const base = path.join(ROOT, 'node_modules/three') + path.sep;
      const file = path.resolve(base, route.slice(7));
      if (!file.startsWith(base)) return send(req, res, 403, {error: 'Invalid path'});
      return send(req, res, 200, await fs.readFile(file), mime[path.extname(file)] || 'application/octet-stream');
    }
    return send(req, res, 404, {error: 'Not found'});
  } catch (error) {
    console.error(req.url, error.message);
    send(req, res, error.status || (error.code === 'ENOENT' ? 404 : 422), {error: error.message, code: error.code});
  }
});
(async () => {
  await loadAssets();
  server.listen(PORT, '127.0.0.1', () => console.log(`WoW models — http://127.0.0.1:${PORT}`));
  try {await archive.open();catalog = await new Catalog(archive).build();metadata = new Metadata(archive, catalog);console.log('Connected', archive.build.version, '—', catalog.items.length, 'models');}
  catch (error) {initError = error;console.error(error.stack);}
})();
server.on('error', async error => {console.error(error.message);await archive.close();process.exit(1);});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {server.close();await archive.close();process.exit(0);});
