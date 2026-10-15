'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {inspectInstallation, discoverInstallations, readSettings, saveInstallation, resolveInstallation} = require('../server/installation');

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wow-viewer-test-'));
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  const root = await fs.realpath(temporary);
  async function install(name, {product = 'wow_classic_beta', active = '1', key = 'a'.repeat(32), data = true} = {}) {
    const location = path.join(root, name);
    await fs.mkdir(path.join(location, '_classic_beta_/World of Warcraft Beta.app/Contents'), {recursive: true});
    if (data) await fs.mkdir(path.join(location, 'Data/data'), {recursive: true});
    await fs.writeFile(path.join(location, '.build.info'), `Active!DEC:1|Product!STRING:0|Build Key!HEX:16|Version!STRING:0\n${active}|${product}|${key}|1.60.1.70374\n`);
    return location;
  }
  return {root, install, settingsPath: path.join(root, 'settings.json')};
}

test('installation accepts root, beta client and app paths, and deduplicates discovery', async t => {
  const {root, install} = await fixture(t), beta = await install('beta with spaces');
  for (const suffix of ['', '_classic_beta_', '_classic_beta_/World of Warcraft Beta.app/Contents']) {
    const found = await inspectInstallation(path.join(beta, suffix));
    assert.equal(found.path, beta);assert.equal(found.product, 'wow_classic_beta');assert.equal(found.version, '1.60.1.70374');
  }
  const alias = path.join(root, 'alias');await fs.symlink(beta, alias);
  assert.equal((await discoverInstallations([beta, alias, path.join(root, 'missing')])).length, 1);
});

test('installation rejects retail, inactive beta, bad build key and incomplete install', async t => {
  const {install} = await fixture(t);
  for (const [name, options] of [['retail', {product: 'wow'}], ['inactive', {active: '0'}], ['key', {key: 'invalid'}], ['missing-data', {data: false}]]) {
    await assert.rejects(inspectInstallation(await install(name, options)), {code: 'INVALID_INSTALLATION'});
  }
});

test('explicit path > environment > saved path > automatic; an invalid choice never falls back', async t => {
  const {root, install, settingsPath} = await fixture(t);
  const explicit = await install('explicit'), envPath = await install('env'), saved = await install('saved'), auto = await install('auto');
  await saveInstallation(path.join(saved, '_classic_beta_'), settingsPath);
  assert.equal((await readSettings(settingsPath)).wowPath, saved);
  const options = {settingsPath, candidates: [auto], env: {WOW_PATH: envPath}};
  assert.equal((await resolveInstallation({...options, explicitPath: explicit})).path, explicit);
  assert.equal((await resolveInstallation(options)).path, envPath);
  assert.equal((await resolveInstallation({...options, env: {}})).path, saved);
  await assert.rejects(resolveInstallation({...options, explicitPath: path.join(root, 'missing')}), {code: 'INVALID_INSTALLATION'});
  await assert.rejects(resolveInstallation({...options, env: {WOW_PATH: path.join(root, 'missing')}}), {code: 'INVALID_INSTALLATION'});
  await assert.rejects(saveInstallation(path.join(root, 'missing'), settingsPath), {code: 'INVALID_INSTALLATION'});
  assert.equal((await readSettings(settingsPath)).wowPath, saved, 'invalid selection must preserve settings');
  await fs.rm(settingsPath);
  assert.equal((await resolveInstallation({...options, env: {}})).path, auto);
  await assert.rejects(resolveInstallation({...options, env: {}, candidates: [auto, saved]}), {code: 'AMBIGUOUS_INSTALLATION'});
  await assert.rejects(resolveInstallation({...options, env: {}, candidates: []}), {code: 'INSTALLATION_NOT_FOUND'});
});

test('malformed saved settings give an actionable reset error', async t => {
  const {settingsPath} = await fixture(t);
  for (const content of ['{', 'null', '[]', '{"wowPath":42}']) {
    await fs.writeFile(settingsPath, content);
    await assert.rejects(readSettings(settingsPath), error => error.code === 'INVALID_SETTINGS' && error.message.includes('--auto'));
  }
});
