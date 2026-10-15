'use strict';
// Filename labels and public keys only. No game assets are downloaded.
const fs = require('node:fs/promises');
const {createWriteStream} = require('node:fs');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const cache = path.resolve(__dirname, '../.cache');

async function request(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(300000), headers: {'User-Agent': 'wow-forever-model-viewer'}});
  if (!response.ok) throw new Error(`Metadata download failed (${response.status}): ${url}`);
  return response;
}

async function download(url, destination) {
  const temporary = destination + '.part';
  try {
    const response = await request(url);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    if (!(await fs.stat(temporary)).size) throw new Error('Metadata download was empty.');
    await fs.rename(temporary, destination);
  } finally {await fs.rm(temporary, {force: true});}
}

(async () => {
  await fs.mkdir(path.join(cache, 'dbd'), {recursive: true});
  await download('https://raw.githubusercontent.com/wowdev/TACTKeys/master/WoW.txt', path.join(cache, 'tact-keys.txt'));
  console.log('Updated public key metadata');
  const listfile = path.join(cache, 'listfile.csv');
  const existing = await fs.stat(listfile).catch(() => null);
  if (!existing?.size) {
    const release = await (await request('https://api.github.com/repos/wowdev/wow-listfile/releases/latest')).json();
    const asset = release.assets?.find(item => item.name === 'community-listfile.csv');
    if (!asset) throw new Error('No community filename list found in the latest release.');
    console.log('Downloading filename labels…');
    await download(asset.browser_download_url, listfile);
    console.log('Filename labels downloaded');
  }
  console.log('Setup complete. Run npm start, or npm run build:mac.');
})().catch(error => {console.error(error.message);process.exitCode = 1;});
