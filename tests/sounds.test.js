'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {soundIndex} = require('../server/sounds');

test('sound list contains only named audio in sound/ with installed beta manifest membership', async () => {
  const archive = {
    names: new Map([[1, 'sound/creature/wolf/attack.ogg'], [2, 'sound/music/theme.mp3'], [3, 'sound/test/tone.wav'], [4, 'sound/uninstalled.ogg'], [5, 'sound/not-in-beta.ogg'], [6, 'sound/note.txt'], [7, 'world/ambient.ogg']]),
    files: new Map([[1, {local: true, size: 100}], [2, {local: true, size: 300}], [3, {local: true, size: 200}], [4, {local: false}], [6, {local: true}], [7, {local: true}]])
  };
  // Table row IDs and kit IDs are not file IDs. References cannot admit absent files.
  const entries = new Map([[2, {FileDataID: 1, SoundKitID: 2}], [9, {FileDataID: 1}], [10, {FileDataID: 3}], [11, {FileDataID: 4}], [12, {FileDataID: 5}]]);
  assert.deepEqual(soundIndex(archive, entries), [[1, 'sound/creature/wolf/attack.ogg', 100, true], [2, 'sound/music/theme.mp3', 300, false], [3, 'sound/test/tone.wav', 200, true]]);
  const {selectModels, buildFolderTree, referenceLabel} = await import('../public/catalog.mjs');
  const sounds = soundIndex(archive, entries).map(([id, path, size, inBetaTables]) => ({id, path, size, inBetaTables, name: path.split('/').at(-1)}));
  assert.deepEqual(selectModels(sounds, {folder: 'sound/', sort: 'size', direction: 'desc'}).map(item => item.id), [2, 3, 1]);
  assert.deepEqual(selectModels(sounds, {folder: 'sound/', q: 'wolf'}).map(item => item.id), [1]);
  assert.deepEqual(selectModels(sounds, {folder: 'sound/music/'}).map(item => item.id), [2]);
  assert.equal(buildFolderTree(sounds).index.get('sound/').count, 3);
  assert.equal(referenceLabel('sound/music/'), 'sound');
  assert.deepEqual(selectModels(sounds, {folder: 'sound/', table: 'yes'}).map(item => item.id), [1, 3]);
  assert.deepEqual(selectModels(sounds, {folder: 'sound/', table: 'no'}).map(item => item.id), [2]);
  assert.deepEqual(selectModels(sounds, {folder: 'sound/music/', table: 'yes'}), []);
  assert.deepEqual(selectModels(sounds, {folder: 'sound/', table: 'no', q: 'theme', sort: 'size'}).map(item => item.id), [2]);
});
