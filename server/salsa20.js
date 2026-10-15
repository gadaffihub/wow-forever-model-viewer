'use strict';
// Salsa20/20 with a 16- or 32-byte key and 8-byte nonce. Used only to read BLTE.
function salsa20(input, key, nonce) {
  if (![16, 32].includes(key.length) || nonce.length !== 8) throw new Error('Invalid Salsa20 key or nonce length');
  const state = new Uint32Array(16), output = Buffer.alloc(input.length);
  const constants = Buffer.from(key.length === 32 ? 'expand 32-byte k' : 'expand 16-byte k');
  for (let i = 0; i < 4; i++) {
    state[i * 5] = constants.readUInt32LE(i * 4);
    state[i + 1] = key.readUInt32LE(i * 4);
    state[i + 11] = key.readUInt32LE((key.length === 32 ? 16 : 0) + i * 4);
  }
  state[6] = nonce.readUInt32LE(0);state[7] = nonce.readUInt32LE(4);
  const rotate = (n, k) => (n << k) | (n >>> (32 - k));
  const stream = Buffer.alloc(64);
  for (let offset = 0; offset < input.length; offset += 64) {
    const x = new Uint32Array(state);
    const quarter = (a, b, c, d) => {
      x[b] ^= rotate((x[a] + x[d]) >>> 0, 7);
      x[c] ^= rotate((x[b] + x[a]) >>> 0, 9);
      x[d] ^= rotate((x[c] + x[b]) >>> 0, 13);
      x[a] ^= rotate((x[d] + x[c]) >>> 0, 18);
    };
    for (let round = 0; round < 10; round++) {
      quarter(0, 4, 8, 12);quarter(5, 9, 13, 1);quarter(10, 14, 2, 6);quarter(15, 3, 7, 11);
      quarter(0, 1, 2, 3);quarter(5, 6, 7, 4);quarter(10, 11, 8, 9);quarter(15, 12, 13, 14);
    }
    for (let i = 0; i < 16; i++) stream.writeUInt32LE((x[i] + state[i]) >>> 0, i * 4);
    for (let i = 0; i < Math.min(64, input.length - offset); i++) output[offset + i] = input[offset + i] ^ stream[i];
    state[8] = (state[8] + 1) >>> 0;if (!state[8]) state[9] = (state[9] + 1) >>> 0;
  }
  return output;
}
module.exports = {salsa20};
