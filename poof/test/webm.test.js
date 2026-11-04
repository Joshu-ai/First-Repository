'use strict';
// public/webm.js: reading a WebM recording, and taking its sound out for Mute.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const W = require('../public/webm');

// A real recording from Chromium's MediaRecorder: VP8 picture, Opus sound.
// This Chromium writes a finished file (known sizes, a SeekHead and Cues);
// others write the live layout, with unknown sizes, built by hand below.
const REAL = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'clip-with-sound.webm')));
const MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT_ID = Buffer.from([0x18, 0x53, 0x80, 0x67]);
// the Segment's size as written (-1 for unknown), and how many bytes follow its header
function segmentSize(file) {
  const b = Buffer.from(file);
  const at = b.indexOf(SEGMENT_ID) + 4;
  assert.equal(b[at], 0x01, 'an 8-byte size');
  const raw = b.subarray(at + 1, at + 8);
  return { size: raw.every((x) => x === 0xff) ? -1 : raw.readUIntBE(0, 6) * 256 + raw[6], rest: b.length - at - 8 };
}

// a tiny EBML writer for hand-made files: el(id, ...contents) with a known
// size, open(id, ...) with an unknown one
const idBytes = (id) => { const out = []; for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256); return out; };
const bytes = (parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : Buffer.from(p))));
const sizeBytes = (n) => (n < 127 ? [0x80 | n] : [0x01, 0, 0, 0, (n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const el = (id, ...parts) => { const body = bytes(parts); return Buffer.concat([Buffer.from(idBytes(id)), Buffer.from(sizeBytes(body.length)), body]); };
const open = (id, ...parts) => Buffer.concat([Buffer.from(idBytes(id)), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), bytes(parts)]);
const trackEntry = (number, type, codec) => el(0xae, el(0xd7, [number]), el(0x83, [type]), el(0x86, codec));
const simple = (track, tag) => el(0xa3, [0x80 | track, 0, 0, 0x80], tag);
const group = (track, tag) => el(0xa0, el(0xa1, [0x80 | track, 0, 0, 0], tag));

// audio is track 1 here, sizes are known, and it has the extras a recorder
// writing a finished file adds: an index (SeekHead), Cues, and a checksum
function handMade() {
  return new Uint8Array(Buffer.concat([
    el(0x1a45dfa3, el(0x4282, 'webm')),
    el(0x18538067,
      el(0x114d9b74, el(0x4dbb, [1, 2, 3])),
      el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40])),
      el(0x1654ae6b, trackEntry(1, 2, 'A_OPUS'), trackEntry(2, 1, 'V_VP8')),
      el(0x1f43b675, el(0xbf, [9, 9, 9, 9]), el(0xe7, [0]), simple(1, 'a1'), simple(2, 'v1'), group(1, 'a2'), group(2, 'v2')),
      el(0x1f43b675, el(0xe7, [40]), simple(2, 'v3'), simple(1, 'a3')),
      el(0x1c53bb6b, el(0xbb, [0xb3, 0x81, 0]))),
  ]));
}

test('reads what a real recording holds', () => {
  const { tracks, blocks } = W.info(REAL);
  assert.deepEqual(tracks, [{ number: 1, type: 1, codec: 'V_VP8' }, { number: 2, type: 2, codec: 'A_OPUS' }]);
  assert.ok(blocks[1] > 5 && blocks[2] > 5, `picture and sound blocks (${JSON.stringify(blocks)})`);
});

test('takes the sound out of a real recording and keeps every picture block', () => {
  const before = W.info(REAL);
  const out = W.stripAudio(REAL);
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual([...out.subarray(0, 4)], MAGIC, 'still a WebM');
  const after = W.info(out);
  assert.deepEqual(after.tracks, [{ number: 1, type: 1, codec: 'V_VP8' }], 'only the picture track is listed');
  assert.deepEqual(after.blocks, { 1: before.blocks[1] }, 'every picture block, no sound blocks');
  assert.ok(out.length < REAL.length * 0.8, `smaller without the sound (${REAL.length} -> ${out.length})`);
  const text = Buffer.from(out).toString('latin1');
  assert.ok(!text.includes('A_OPUS') && !text.includes('OpusHead'), 'nothing of the sound is left');
  // a known size is worked out again for what is left; an unknown one stays unknown
  const was = segmentSize(REAL);
  const now = segmentSize(out);
  if (was.size === -1) assert.equal(now.size, -1, 'the Segment size stays unknown');
  else assert.equal(now.size, now.rest, 'the Segment size matches what is in it');
  assert.equal(W.stripAudio(out), out, 'with no sound left, the bytes come back as they are');
});

test('takes the sound out of other layouts: known sizes, block groups, audio first', () => {
  const file = handMade();
  assert.deepEqual(W.info(file).blocks, { 1: 3, 2: 3 });
  const out = W.stripAudio(file);
  const { tracks, blocks } = W.info(out);
  assert.deepEqual(tracks, [{ number: 2, type: 1, codec: 'V_VP8' }]);
  assert.deepEqual(blocks, { 2: 3 }, 'simple blocks and block groups alike');
  const text = Buffer.from(out).toString('latin1');
  for (const tag of ['v1', 'v2', 'v3']) assert.ok(text.includes(tag), `kept picture block ${tag}`);
  for (const tag of ['a1', 'a2', 'a3', 'A_OPUS']) assert.ok(!text.includes(tag), `dropped ${tag}`);
  // the index, the cues and the checksum point at bytes that moved, so they go
  for (const id of [[0x11, 0x4d, 0x9b, 0x74], [0x1c, 0x53, 0xbb, 0x6b]]) {
    assert.equal(Buffer.from(out).indexOf(Buffer.from(id)), -1, `dropped element ${Buffer.from(id).toString('hex')}`);
  }
  assert.equal(Buffer.from(out).indexOf(Buffer.from([0xbf, 0x84, 9, 9])), -1, 'dropped the checksum');
  assert.ok(text.includes('webm') && Buffer.from(out).indexOf(Buffer.from([0x2a, 0xd7, 0xb1])) > 0, 'header and Info kept');
});

test('a cluster of unknown size ends where the next one starts', () => {
  const file = new Uint8Array(Buffer.concat([
    el(0x1a45dfa3, el(0x4282, 'webm')),
    open(0x18538067,
      el(0x1654ae6b, trackEntry(1, 1, 'V_VP8'), trackEntry(2, 2, 'A_OPUS')),
      open(0x1f43b675, el(0xe7, [0]), simple(1, 'v1'), simple(2, 'a1')),
      open(0x1f43b675, el(0xe7, [9]), simple(2, 'a2'), simple(1, 'v2'))),
  ]));
  assert.deepEqual(W.info(file).blocks, { 1: 2, 2: 2 }, 'both clusters found');
  const out = W.stripAudio(file);
  assert.deepEqual(W.info(out).blocks, { 1: 2 });
  assert.equal(segmentSize(out).size, -1, 'a live recording keeps its open-ended sizes');
  assert.equal(Buffer.from(out).indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff])) > 0, true, 'clusters too');
});

test('anything that is not a WebM it can read is refused', () => {
  const mp4 = new Uint8Array(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(12)]));
  const truncated = REAL.subarray(0, 300);
  const noTracks = new Uint8Array(Buffer.concat([el(0x1a45dfa3, el(0x4282, 'webm')), el(0x18538067, el(0x1549a966))]));
  for (const [name, input] of [['empty', new Uint8Array(0)], ['mp4', mp4], ['truncated', truncated],
    ['no tracks', noTracks], ['zero bytes', new Uint8Array(64)]]) {
    assert.throws(() => W.stripAudio(input), /Not a WebM file Poof can read/, name);
    assert.throws(() => W.info(input), /Not a WebM file Poof can read/, name);
  }
});

test('the same file works in the browser as window.PoofWebm, and takes an ArrayBuffer', () => {
  const window = {};
  window.window = window;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'webm.js'), 'utf8'), vm.createContext(window));
  const copy = REAL.slice();
  const out = window.PoofWebm.stripAudio(copy.buffer);
  assert.deepEqual(Buffer.from(out), Buffer.from(W.stripAudio(REAL)));
  assert.deepEqual(Buffer.from(copy), Buffer.from(REAL), 'the input is left alone');
});
