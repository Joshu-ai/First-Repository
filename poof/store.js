'use strict';
// All persistence goes through this file. Swap it for a real database later
// without touching server.js routes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EMPTY = () => ({
  users: [], sessions: {}, friendships: [], snaps: [],
  messages: [], stories: [], streaks: {},
});

class Store {
  constructor(dir) {
    this.dir = dir;
    this.mediaDir = path.join(dir, 'media');
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.db = EMPTY();
    if (fs.existsSync(this.file)) {
      this.db = { ...EMPTY(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    }
    this.saveTimer = null;
  }

  id() {
    return crypto.randomBytes(9).toString('base64url');
  }

  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }

  // Media: stored as files, referenced by id.
  putMedia(buffer, ext) {
    const name = this.id() + '.' + ext;
    fs.writeFileSync(path.join(this.mediaDir, name), buffer);
    return name;
  }

  readMedia(name) {
    return fs.readFileSync(path.join(this.mediaDir, path.basename(name)));
  }

  deleteMedia(name) {
    if (!name) return;
    try { fs.unlinkSync(path.join(this.mediaDir, path.basename(name))); } catch {}
  }
}

module.exports = { Store };
