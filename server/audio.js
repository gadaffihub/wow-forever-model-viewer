'use strict';
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');

let decoderPath;
async function decodeOgg(data) {
  if (!decoderPath) {
    const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))];
    for (const file of candidates) {
      try {await fs.access(file, constants.X_OK);decoderPath = file;break;} catch {}
    }
    if (!decoderPath) throw new Error('Ogg playback on this macOS version requires FFmpeg.');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(decoderPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], {stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = [];let length = 0, error = '', failed = false;
    const fail = reason => {if (failed) return;failed = true;clearTimeout(timer);child.kill();reject(reason);};
    const timer = setTimeout(() => fail(new Error('Sound conversion timed out.')), 30000);
    child.on('error', fail);child.stdin.on('error', fail);
    child.stdout.on('data', chunk => {length += chunk.length;if (length > 128 * 1024 * 1024) {fail(new Error('Decoded sound exceeds the playback size limit.'));return;}chunks.push(chunk);});
    child.stderr.on('data', chunk => {error = (error + chunk.toString()).slice(-2000);});
    child.on('close', code => {
      clearTimeout(timer);if (failed) return;
      if (code !== 0) {reject(new Error('Cannot decode installed sound: ' + error.trim()));return;}
      const wav = Buffer.concat(chunks);
      // A pipe has unknown lengths. Fill both sizes for Safari's WAV seeking.
      if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') {reject(new Error('Invalid decoded sound.'));return;}
      wav.writeUInt32LE(wav.length - 8, 4);
      for (let offset = 12; offset + 8 <= wav.length;) {
        if (wav.toString('ascii', offset, offset + 4) === 'data') {wav.writeUInt32LE(wav.length - offset - 8, offset + 4);resolve(wav);return;}
        const size = wav.readUInt32LE(offset + 4);offset += 8 + size + (size & 1);
      }
      reject(new Error('Decoded sound has no sample data.'));
    });
    child.stdin.end(data);
  });
}

function audioType(data) {
  if (data.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  throw new Error('This installed file is not a supported sound.');
}

function createAudioReader(archive) {
  const cache = new Map(), pending = new Map();let cachedBytes = 0;
  return async function readAudio(id, {wav = false} = {}) {
    const key = `${id}:${wav ? 'wav' : 'original'}`;
    if (cache.has(key)) {const asset = cache.get(key);cache.delete(key);cache.set(key, asset);return asset;}
    if (pending.has(key)) return pending.get(key);
    const promise = (async () => {
      let data = await archive.getFile(id); // Verifies the installed beta's content hash.
      let type = audioType(data);
      if (wav && type === 'audio/ogg') {data = await decodeOgg(data);type = 'audio/wav';}
      const asset = {data, type};
      if (data.length <= 24 * 1024 * 1024) {
        cache.set(key, asset);cachedBytes += data.length;
        while (cache.size > 8 || cachedBytes > 24 * 1024 * 1024) {
          const first = cache.keys().next().value;cachedBytes -= cache.get(first).data.length;cache.delete(first);
        }
      }
      return asset;
    })();
    pending.set(key, promise);
    try {return await promise;} finally {pending.delete(key);}
  };
}

function audioRange(header, size) {
  if (!header) return {start: 0, end: size - 1, partial: false};
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return {start, end, partial: true};
}

function sendAudio(req, res, asset) {
  const size = asset.data.length, range = audioRange(req.headers.range, size);
  const headers = {'Content-Type': asset.type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  if (!range) {res.writeHead(416, {...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0});res.end();return;}
  headers['Content-Length'] = range.end - range.start + 1;
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  res.writeHead(range.partial ? 206 : 200, headers);
  res.end(req.method === 'HEAD' ? undefined : asset.data.subarray(range.start, range.end + 1));
}

module.exports = {audioType, audioRange, createAudioReader, sendAudio};
