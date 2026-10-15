'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const SETTINGS_PATH = path.resolve(__dirname, '../.cache/settings.json');

function installError(code, message) {return Object.assign(new Error(message), {code});}

async function inspectInstallation(input) {
  if (typeof input !== 'string' || !input.trim()) throw installError('INVALID_INSTALLATION', 'Choose the World of Warcraft folder containing .build.info and Data.');
  let candidate = path.resolve(input.trim().replace(/^~(?=$|[/\\])/, os.homedir()));
  const original = candidate;
  // Accept the installation root, a client directory, or the game app inside it.
  for (let depth = 0; depth < 5; depth++) {
    let text;
    try {text = await fs.readFile(path.join(candidate, '.build.info'), 'utf8');} catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw installError('INVALID_INSTALLATION', `Cannot read ${candidate}: ${error.message}`);
    }
    if (text) {
      const lines = text.trim().split(/\r?\n/), keys = lines.shift().split('|').map(value => value.split('!')[0]);
      const builds = lines.map(line => Object.fromEntries(line.split('|').map((value, index) => [keys[index], value])));
      const build = builds.find(row => row.Active === '1' && row.Product === 'wow_classic_beta');
      if (!build) throw installError('INVALID_INSTALLATION', `${candidate} has no active wow_classic_beta build. Select the installation containing the Forever Beta.`);
      if (!/^[a-f0-9]{32}$/i.test(build['Build Key'] || '')) throw installError('INVALID_INSTALLATION', 'The beta build key in .build.info is invalid.');
      try {if (!(await fs.stat(path.join(candidate, 'Data/data'))).isDirectory()) throw new Error('Not a directory');}
      catch {throw installError('INVALID_INSTALLATION', `${candidate} is missing Data/data. Finish installing the beta in Battle.net.`);}
      return {path: await fs.realpath(candidate), version: build.Version, product: build.Product, build};
    }
    const parent = path.dirname(candidate);if (parent === candidate) break;candidate = parent;
  }
  throw installError('INVALID_INSTALLATION', `No .build.info found at or above ${original}. Select World of Warcraft or its _classic_beta_ folder.`);
}

async function defaultCandidates() {
  const home = os.homedir();
  const candidates = ['/Applications/World of Warcraft', path.join(home, 'Applications/World of Warcraft'), path.join(home, 'Games/World of Warcraft'), path.join(home, 'World of Warcraft')];
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) candidates.push(path.join(base, 'World of Warcraft'));
  try {
    for (const volume of await fs.readdir('/Volumes')) for (const suffix of ['World of Warcraft', 'Applications/World of Warcraft', 'Games/World of Warcraft']) candidates.push(path.join('/Volumes', volume, suffix));
  } catch {}
  return candidates;
}

async function discoverInstallations(candidates) {
  const found = new Map();
  for (const candidate of candidates || await defaultCandidates()) {
    try {const installation = await inspectInstallation(candidate);found.set(installation.path, installation);} catch {}
  }
  return [...found.values()];
}

async function readSettings(file = SETTINGS_PATH) {
  try {
    const settings = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || (settings.wowPath !== undefined && typeof settings.wowPath !== 'string')) throw new Error('Invalid settings format.');
    return settings;
  }
  catch (error) {if (error.code === 'ENOENT') return {};throw installError('INVALID_SETTINGS', `Cannot read local settings. Run npm run configure -- --auto to reset them. ${error.message}`);}
}

async function saveInstallation(input, file = SETTINGS_PATH) {
  const installation = await inspectInstallation(input);
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file + '.tmp', JSON.stringify({wowPath: installation.path}, null, 2) + '\n');
  await fs.rename(file + '.tmp', file);
  return installation;
}

async function resolveInstallation({explicitPath, env = process.env, settingsPath = SETTINGS_PATH, candidates} = {}) {
  // An invalid explicit choice must never silently open a different installation.
  if (explicitPath) return inspectInstallation(explicitPath);
  if (env.WOW_PATH) return inspectInstallation(env.WOW_PATH);
  const settings = await readSettings(settingsPath);
  if (settings.wowPath) return inspectInstallation(settings.wowPath);
  const found = await discoverInstallations(candidates);
  if (found.length === 1) return found[0];
  if (found.length > 1) throw installError('AMBIGUOUS_INSTALLATION', `Found multiple beta installations:\n${found.map(item => item.path).join('\n')}\nChoose one with npm run configure -- "/path/to/World of Warcraft".`);
  throw installError('INSTALLATION_NOT_FOUND', 'No installed Forever Beta found. Use the app’s Choose WoW beta installation menu, or run npm run configure -- "/path/to/World of Warcraft".');
}

module.exports = {SETTINGS_PATH, inspectInstallation, discoverInstallations, readSettings, saveInstallation, resolveInstallation};
