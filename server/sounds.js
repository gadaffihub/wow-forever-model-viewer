'use strict';
const {readDB} = require('./db2');

function soundIndex(archive, soundKitEntries) {
  const referenced = new Set([...soundKitEntries.values()].map(row => row.FileDataID).filter(id => Number.isSafeInteger(id) && id > 0));
  const items = [];
  for (const [id, name] of archive.names) {
    const file = archive.files.get(id);
    if (file?.local && /^sound\/.+\.(?:ogg|mp3|wav)$/i.test(name)) items.push([id, name, file.size, referenced.has(id)]);
  }
  // Compact tuples keep the complete, continuously browsable sound list small.
  return items;
}

async function loadSoundIndex(archive) {
  // A table read failure must not silently label every sound as unreferenced.
  const table = await readDB(archive, 'SoundKitEntry');
  return {items: soundIndex(archive, table.rows), referenceTable: 'SoundKitEntry', skippedRecords: table.skipped};
}

module.exports = {soundIndex, loadSoundIndex};
