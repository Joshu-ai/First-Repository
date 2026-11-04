'use strict';
// Poof's WebM reader: what is in a recording, and the same recording with
// its sound taken out, without re-encoding it (Mute in the video editor).
//
// A WebM file is a tree of EBML elements: an id, a size, then the data. The
// Tracks element lists each track (number, type 1 video / 2 audio, codec),
// and each Cluster holds blocks that start with the number of the track they
// belong to. Taking the sound out drops the audio track entries and their
// blocks and rewrites the sizes around them. Browsers recording live leave
// the Segment's and the Clusters' sizes "unknown" (they run until the next
// element of their level); those stay unknown.
//
// PoofWebm.info(bytes) -> { tracks: [{ number, type, codec }], blocks: { [number]: count } }
// PoofWebm.stripAudio(bytes) -> Uint8Array (the bytes themselves when there is no sound to take out)
// Both throw on anything that isn't a WebM they can read.
(function (root) {
  const ID = {
    EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b,
    TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, Cluster: 0x1f43b675,
    SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, Cues: 0x1c53bb6b, Chapters: 0x1043a770,
    Tags: 0x1254c367, Attachments: 0x1941a469, CRC32: 0xbf,
  };
  // the Segment's own children: one of these ends a Cluster of unknown size
  const SEGMENT_LEVEL = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cues, ID.Chapters, ID.Tags, ID.Attachments]);
  const AUDIO = 2;
  const UNKNOWN = -1;

  const bad = () => new Error('Not a WebM file Poof can read.');

  function readId(b, i) {
    const first = b[i];
    const len = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
    if (!len || i + len > b.length) throw bad();
    let id = 0;
    for (let k = 0; k < len; k++) id = id * 256 + b[i + k];
    return { id, len };
  }

  // a variable-length number (sizes, and the track number in a block); all
  // value bits set means "unknown"
  function readVint(b, i) {
    const first = b[i];
    let len = 1;
    let mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || i + len > b.length) throw bad();
    let value = first & (mask - 1);
    let allOnes = value === mask - 1;
    for (let k = 1; k < len; k++) {
      value = value * 256 + b[i + k];
      if (b[i + k] !== 0xff) allOnes = false;
    }
    return { value: allOnes ? UNKNOWN : value, len };
  }

  // The elements in b[start, end) as { id, start, dataStart, end, unknown },
  // and where the list ended (a Cluster of unknown size stops early).
  function children(b, start, end, parent) {
    const list = [];
    let i = start;
    while (i < end) {
      const { id, len } = readId(b, i);
      if (parent === ID.Cluster && SEGMENT_LEVEL.has(id)) break;
      const size = readVint(b, i + len);
      const dataStart = i + len + size.len;
      let stop;
      if (size.value !== UNKNOWN) stop = dataStart + size.value;
      else if (id === ID.Cluster) stop = children(b, dataStart, end, ID.Cluster).end;
      else stop = end; // the Segment, or anything else of unknown size, runs to the end
      if (stop > end) throw bad();
      list.push({ id, start: i, dataStart, end: stop, unknown: size.value === UNKNOWN });
      i = stop;
    }
    return { list, end: i };
  }
  const kids = (b, e) => children(b, e.dataStart, e.end, e.id).list;

  function uint(b, e) {
    let v = 0;
    for (let i = e.dataStart; i < e.end; i++) v = v * 256 + b[i];
    return v;
  }

  function track(b, entry) {
    const t = { number: 0, type: 0, codec: '' };
    for (const f of kids(b, entry)) {
      if (f.id === ID.TrackNumber) t.number = uint(b, f);
      else if (f.id === ID.TrackType) t.type = uint(b, f);
      else if (f.id === ID.CodecID) t.codec = String.fromCharCode(...b.subarray(f.dataStart, f.end)).replace(/\0+$/, '');
    }
    return t;
  }

  // the track a SimpleBlock or BlockGroup belongs to, or null for anything else
  function blockTrack(b, e) {
    if (e.id === ID.SimpleBlock) return readVint(b, e.dataStart).value;
    if (e.id !== ID.BlockGroup) return null;
    const block = kids(b, e).find((x) => x.id === ID.Block);
    return block ? readVint(b, block.dataStart).value : null;
  }

  function parse(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    const top = children(b, 0, b.length, 0).list;
    if (top[0]?.id !== ID.EBML) throw bad();
    const segment = top.find((e) => e.id === ID.Segment);
    if (!segment) throw bad();
    const level = kids(b, segment);
    const tracksEl = level.find((e) => e.id === ID.Tracks);
    if (!tracksEl) throw bad();
    const tracks = kids(b, tracksEl).filter((e) => e.id === ID.TrackEntry).map((e) => track(b, e));
    return { b, top, segment, level, tracks };
  }

  function info(input) {
    const { b, level, tracks } = parse(input);
    const blocks = {};
    for (const t of tracks) blocks[t.number] = 0;
    for (const cluster of level.filter((e) => e.id === ID.Cluster)) {
      for (const e of kids(b, cluster)) {
        const n = blockTrack(b, e);
        if (n !== null) blocks[n] = (blocks[n] || 0) + 1;
      }
    }
    return { tracks, blocks };
  }

  // an element rebuilt from its id and new contents; sizes are written as
  // 8-byte numbers, which EBML allows for any size
  function element(id, parts, unknown) {
    const idBytes = [];
    for (let v = id; v > 0; v = Math.floor(v / 256)) idBytes.unshift(v % 256);
    const size = parts.reduce((n, p) => n + p.length, 0);
    const sizeBytes = [0x01];
    for (let k = 6; k >= 0; k--) sizeBytes.push(unknown ? 0xff : Math.floor(size / 256 ** k) % 256);
    return concat([Uint8Array.from(idBytes), Uint8Array.from(sizeBytes), ...parts]);
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  function stripAudio(input) {
    const { b, top, segment, level, tracks } = parse(input);
    const audio = new Set(tracks.filter((t) => t.type === AUDIO).map((t) => t.number));
    if (!audio.size) return b;
    const raw = (e) => b.subarray(e.start, e.end);
    // a checksum no longer matches once the contents change, so it goes
    const keep = (list, drop) => list.filter((e) => e.id !== ID.CRC32 && !drop(e)).map(raw);
    const body = [];
    for (const e of level) {
      // SeekHead and Cues point at byte positions that move; players do without them
      if (e.id === ID.SeekHead || e.id === ID.Cues) continue;
      if (e.id === ID.Tracks) {
        body.push(element(e.id, keep(kids(b, e), (t) => t.id === ID.TrackEntry && audio.has(track(b, t).number)), e.unknown));
      } else if (e.id === ID.Cluster) {
        body.push(element(e.id, keep(kids(b, e), (x) => audio.has(blockTrack(b, x))), e.unknown));
      } else body.push(raw(e));
    }
    return concat(top.map((e) => (e === segment ? element(e.id, body, e.unknown) : raw(e))));
  }

  const api = { info, stripAudio };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PoofWebm = api;
})(typeof window !== 'undefined' ? window : globalThis);
