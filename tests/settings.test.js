'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {configureInstallation} = require('../server/installation-http');

test('viewer settings survive storage and reject malformed preferences', async () => {
  const {normalizeSettings, defaultSettings, startupFolder} = await import('../public/settings.mjs');
  for (const input of [null, [], 'bad', {autoplayAnimations: 'false', autoplaySounds: 0, skinInterval: NaN, startupFolder: 'bogus/'}]) assert.deepEqual(normalizeSettings(input), defaultSettings);
  const custom = {autoplayAnimations: true, autoplaySounds: false, cycleSkins: true, skinInterval: 8, startupFolder: 'sound/music/'};
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(custom))), custom);
  assert.equal(startupFolder(normalizeSettings(custom), 'creature/'), 'sound/music/');
  assert.equal(startupFolder(defaultSettings, 'creature/wolf/'), 'creature/wolf/');
  assert.equal(startupFolder(defaultSettings, undefined), 'creature/');
  assert.equal(normalizeSettings({skinInterval: -1}).skinInterval, 1);
  assert.equal(normalizeSettings({skinInterval: 999}).skinInterval, 60);
  for (const folder of ['../sound/', 'sound/../../', 'sound//music/', 'sound/music.mp3']) assert.equal(normalizeSettings({startupFolder: folder}).startupFolder, 'last');
});

test('installation settings accept only same-origin JSON and validate before saving', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wow-settings-http-'));
  t.after(() => fs.rm(temp, {recursive: true, force: true}));
  const game = path.join(temp, 'World of Warcraft'), settingsPath = path.join(temp, 'settings.json');
  await fs.mkdir(path.join(game, 'Data/data'), {recursive: true});
  await fs.writeFile(path.join(game, '.build.info'), `Active!DEC:1|Product!STRING:0|Build Key!HEX:16|Version!STRING:0\n1|wow_classic_beta|${'a'.repeat(32)}|1.60.1.70374\n`);
  function request(body, headers = {}) {
    const req = Readable.from([Buffer.from(body)]);
    req.headers = {host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'content-type': 'application/json', ...headers};
    return req;
  }
  const body = JSON.stringify({path: game});
  for (const origin of [undefined, 'null', 'https://example.com', 'http://127.0.0.1:4318']) await assert.rejects(configureInstallation(request(body, {origin}), settingsPath), {status: 403});
  await assert.rejects(configureInstallation(request(body, {'content-type': 'text/plain'}), settingsPath), {status: 415});
  await assert.rejects(configureInstallation(request('{'), settingsPath), {status: 400});
  await assert.rejects(configureInstallation(request(' '.repeat(8193)), settingsPath), {status: 413});
  await assert.rejects(fs.access(settingsPath));
  const installed = await configureInstallation(request(body), settingsPath);
  assert.equal(installed.path, await fs.realpath(game));
  assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).wowPath, installed.path);
  await assert.rejects(configureInstallation(request(JSON.stringify({path: path.join(temp, 'missing')})), settingsPath), {code: 'INVALID_INSTALLATION'});
  assert.equal(JSON.parse(await fs.readFile(settingsPath, 'utf8')).wowPath, installed.path);
});
