'use strict';

function soundIndex(archive) {
  const items = [];
  for (const [id, name] of archive.names) {
    const file = archive.files.get(id);
    if (file?.local && /^sound\/.+\.(?:ogg|mp3|wav)$/i.test(name)) items.push([id, name, file.size]);
  }
  // Compact tuples keep the complete, continuously browsable sound list small.
  return items;
}

module.exports = {soundIndex};
