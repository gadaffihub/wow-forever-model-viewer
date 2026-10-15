'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {soundIndex} = require('../server/sounds');

test('sound list contains only named audio in sound/ with installed beta manifest membership', async () => {
  const archive = {
    names: new Map([[1, 'sound/creature/wolf/attack.ogg'], [2, 'sound/music/theme.mp3'], [3, 'sound/test/tone.wav'], [4, 'sound/uninstalled.ogg'], [5, 'sound/not-in-beta.ogg'], [6, 'sound/note.txt'], [7, 'world/ambient.ogg']]),
    files: new Map([[1, {local: true, size: 100}], [2, {local: true, size: 300}], [3, {local: true, size: 200}], [4, {local: false}], [6, {local: true}], [7, {local: true}]])
  };
  assert.deepEqual(soundIndex(archive), [[1, 'sound/creature/wolf/attack.ogg', 100], [2, 'sound/music/theme.mp3', 300], [3, 'sound/test/tone.wav', 200]]);
  const {selectModels, buildFolderTree} = await import('../public/catalog.mjs');
  const sounds = soundIndex(archive).map(([id, path, size]) => ({id, path, size, name: path.split('/').at(-1)}));
  assert.deepEqual(selectModels(sounds, {folder: 'sound/', sort: 'size', direction: 'desc'}).map(item => item.id), [2, 3, 1]);
  assert.deepEqual(selectModels(sounds, {folder: 'sound/', q: 'wolf'}).map(item => item.id), [1]);
  assert.deepEqual(selectModels(sounds, {folder: 'sound/music/'}).map(item => item.id), [2]);
  assert.equal(buildFolderTree(sounds).index.get('sound/').count, 3);
});
