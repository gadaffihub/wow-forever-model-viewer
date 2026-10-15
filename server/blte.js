'use strict';
const zlib = require('node:zlib');
const {salsa20} = require('./salsa20');
function decodeBlock(bytes, index, keys, depth = 0) {
  if (depth > 4) throw new Error('Too many nested BLTE encodings.');
  switch (bytes[0]) {
    case 78: return bytes.subarray(1);
    case 90: return zlib.inflateSync(bytes.subarray(1), {maxOutputLength: 512 * 1024 * 1024});
    case 69: {
      let p = 1;const keyLength = bytes[p++];
      if (keyLength !== 8 || bytes.length < p + keyLength + 2) throw new Error('Invalid encrypted BLTE header.');
      const keyName = Buffer.from(bytes.subarray(p, p + keyLength)).reverse().toString('hex').toUpperCase();p += keyLength;
      const nonceLength = bytes[p++];
      if (![4, 8].includes(nonceLength) || bytes.length < p + nonceLength + 1) throw new Error('Invalid encrypted BLTE nonce.');
      const nonce = Buffer.alloc(8);bytes.copy(nonce, 0, p, p + nonceLength);p += nonceLength;
      for (let i = 0; i < 4; i++) nonce[i] ^= (index >>> (8 * i)) & 255;
      if (bytes[p++] !== 83) throw new Error('Unsupported BLTE encryption cipher.');
      const key = keys.get(keyName);
      if (!key) throw Object.assign(new Error(`Encrypted file: key ${keyName} is not available in the installed or public key sets.`), {code: 'MISSING_KEY', keyName});
      return decodeBlock(salsa20(bytes.subarray(p), key, nonce), index, keys, depth + 1);
    }
    default: throw new Error(`Unsupported BLTE block type ${String.fromCharCode(bytes[0] || 0)}.`);
  }
}
function decodeBLTE(buffer, {head = false, partial = false, keys = new Map()} = {}) {
  if (buffer.toString('ascii', 0, 4) !== 'BLTE') throw new Error('Invalid local BLTE record.');
  const header = buffer.readUInt32BE(4), blocks = [];
  if (!header) blocks.push({offset: 8, size: buffer.length - 8});
  else {
    const count = buffer.readUIntBE(9, 3);let offset = header;
    if (header !== 12 + count * 24 || header > buffer.length) throw new Error('Invalid BLTE chunk table.');
    for (let i = 0; i < count; i++) {
      const p = 12 + i * 24, size = buffer.readUInt32BE(p);
      blocks.push({offset, size, decoded: buffer.readUInt32BE(p + 4)});offset += size;
    }
  }
  const result = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.offset + block.size > buffer.length) throw new Error('Truncated BLTE block.');
    let data;
    try {data = decodeBlock(buffer.subarray(block.offset, block.offset + block.size), i, keys);}
    catch (error) {if (partial && error.code === 'MISSING_KEY' && block.decoded) data = Buffer.alloc(block.decoded);else throw error;}
    if (block.decoded !== undefined && data.length !== block.decoded) throw new Error('Corrupt BLTE decoded size.');
    result.push(data);if (head) break;
  }
  const data = Buffer.concat(result);return head ? data.subarray(0, 8) : data;
}
module.exports = {decodeBLTE, decodeBlock};
