// SQLite 데이터베이스 (Node.js 내장 node:sqlite 사용 → Windows에서도 별도 빌드 불필요)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DB_PATH = path.join(DATA_DIR, 'happy.db');

for (const d of [DATA_DIR, PHOTO_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'child' CHECK (role IN ('parent','child')),
  photo TEXT,
  character TEXT,
  emoji TEXT DEFAULT '🙂',
  color TEXT NOT NULL DEFAULT '#4f8cff',
  face_descriptor TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '✅',
  points INTEGER NOT NULL DEFAULT 10,
  slot_id INTEGER REFERENCES time_slots(id) ON DELETE SET NULL,
  deadline TEXT,
  days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  is_family INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, member_id)
);
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'touch',
  points INTEGER NOT NULL DEFAULT 0,
  is_late INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_completions_date ON completions(date);
CREATE INDEX IF NOT EXISTS idx_completions_member ON completions(member_id, date);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL DEFAULT 'member' CHECK (target IN ('member','family')),
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  period TEXT NOT NULL DEFAULT 'week' CHECK (period IN ('day','week','month')),
  threshold INTEGER NOT NULL,
  content TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reward_id INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL DEFAULT 0,
  period TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT,
  celebrated INTEGER NOT NULL DEFAULT 0,
  UNIQUE (reward_id, member_id, period_start)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none','weekly','monthly')),
  memo TEXT,
  icon TEXT DEFAULT '📌',
  notify INTEGER NOT NULL DEFAULT 0,
  notify_before INTEGER NOT NULL DEFAULT 10
);
CREATE TABLE IF NOT EXISTS event_members (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, member_id)
);
CREATE TABLE IF NOT EXISTS media_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT,
  time TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  file TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'server' CHECK (location IN ('server','tablet')),
  volume INTEGER NOT NULL DEFAULT 70,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS rest_days (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (member_id, date)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

const DEFAULT_SETTINGS = {
  reward_period: 'week',
  week_start: '1',
  month_start: '1',
  parents_rewarded: '0',
  late_allowed: '1',
  late_ratio: '1',
  reward_style: 'grape',
  collection_size: '20',
  family_photo: '',
  rest_tickets_per_week: '1',
  encouragements: JSON.stringify([
    '괜찮아, 그럴 수도 있지!',
    '내일 또 해보자! 💪',
    '오늘도 충분히 잘했어!',
    '천천히 해도 괜찮아 🌱',
    '다시 도전하면 돼!',
  ]),
  cheers: JSON.stringify(['최고! 👍', '대단해! 🌟', '멋져요! 🎉', '짱이야! 💯', '해냈다! 🙌', '굿잡! 👏', '와우! 🤩', '완벽해! ✨']),
  child_events: '1',
  calendar_view: 'month',
  event_alerts: '1',
  media_dir: 'media',
  default_media_location: 'server',
  theme: 'auto',
  sound: '1',
  characters: '1',
  font_scale: '1',
  last_settled: '',
};

function seed() {
  const has = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  if (has) return;

  const salt = crypto.randomBytes(16).toString('hex');
  ins.run('pin_salt', salt);
  ins.run('pin_hash', hashPin('0000', salt));

  const m = db.prepare('INSERT INTO members (name, role, emoji, color, sort) VALUES (?, ?, ?, ?, ?)');
  const mom = m.run('엄마', 'parent', '👩', '#ff6b8b', 1).lastInsertRowid;
  const dad = m.run('아빠', 'parent', '👨', '#4f8cff', 2).lastInsertRowid;
  const kid1 = m.run('첫째', 'child', '🧒', '#ffb020', 3).lastInsertRowid;
  const kid2 = m.run('둘째', 'child', '👧', '#2ec27e', 4).lastInsertRowid;

  const s = db.prepare('INSERT INTO time_slots (name, start_time, end_time, sort) VALUES (?, ?, ?, ?)');
  const morning = s.run('아침', '06:00', '09:30', 1).lastInsertRowid;
  const after = s.run('하원·퇴근 후', '15:00', '19:00', 2).lastInsertRowid;
  const night = s.run('자기 전', '19:00', '22:30', 3).lastInsertRowid;

  const t = db.prepare('INSERT INTO tasks (name, icon, points, slot_id, deadline, days, is_family, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const a = db.prepare('INSERT INTO task_assignees (task_id, member_id) VALUES (?, ?)');
  const kids = [kid1, kid2];
  const ALL = '0,1,2,3,4,5,6';
  const WEEKDAY = '1,2,3,4,5';
  const kidTasks = [
    ['인사하기', '👋', 1, morning, '09:00', ALL],
    ['아침 물 마시기', '💧', 1, morning, '09:00', ALL],
    ['유산균 먹기', '🦠', 1, morning, '09:00', ALL],
    ['비타민 C 먹기', '🍊', 1, morning, '09:00', ALL],
    ['양치하기', '🪥', 1, morning, '09:00', ALL],
    ['옷입기', '👕', 1, morning, '09:00', WEEKDAY],
    ['양말 신기', '🧦', 1, morning, '09:00', WEEKDAY],
    ['하원 후 가방정리', '🎒', 1, after, '18:30', WEEKDAY],
    ['오늘 입은 옷 세탁실에 가져다 두기', '🧺', 1, night, '21:00', ALL],
  ];
  let sort = 1;
  for (const [name, icon, pts, slot, dl, days] of kidTasks) {
    const id = t.run(name, icon, pts, slot, dl, days, 0, sort++).lastInsertRowid;
    for (const k of kids) a.run(id, k);
  }
  const parentTasks = [
    [mom, '아침 물 마시기', '💧', 1, morning, '09:00', ALL],
    [mom, '책 10쪽 읽기', '📖', 1, night, '22:30', ALL],
    [mom, '아이들과 대화 10분', '💬', 1, after, '21:00', ALL],
    [dad, '아침 물 마시기', '💧', 1, morning, '09:00', ALL],
    [dad, '책 10쪽 읽기', '📖', 1, night, '22:30', ALL],
    [dad, '아이들과 대화 10분', '💬', 1, after, '21:00', ALL],
  ];
  for (const [who, name, icon, pts, slot, dl, days] of parentTasks) {
    const id = t.run(name, icon, pts, slot, dl, days, 0, sort++).lastInsertRowid;
    a.run(id, who);
  }
  const fam = t.run('자기 전 거실 정리', '🧸', 1, night, '21:30', ALL, 1, sort++).lastInsertRowid;
  for (const who of [mom, dad, kid1, kid2]) a.run(fam, who);

  const r = db.prepare('INSERT INTO rewards (target, member_id, period, threshold, content) VALUES (?, ?, ?, ?, ?)');
  for (const k of kids) {
    r.run('member', k, 'week', 30, '아이스크림 🍦');
    r.run('member', k, 'week', 55, '주말 영화 고르기 🎬');
  }
  r.run('family', null, 'week', 140, '가족 외식 🍕');
  ins.run('units_migrated', '1');
}

seed();

// v0.2: "점수" → "모으기 개수" 전환 (할 일마다 1개, 늦게 해도 똑같이 1개)
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'units_migrated'").get()) {
  db.exec('BEGIN');
  try {
    db.exec('UPDATE tasks SET points = 1');
    db.exec('UPDATE completions SET points = 1');
    db.exec('UPDATE rewards SET threshold = MAX(1, CAST(ROUND(threshold / 8.0) AS INTEGER))');
    db.exec('UPDATE reward_grants SET points = (SELECT COUNT(*) FROM completions c WHERE c.date BETWEEN reward_grants.period_start AND reward_grants.period_end AND (reward_grants.member_id = 0 OR c.member_id = reward_grants.member_id))');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('late_ratio', '1'), ('units_migrated', '1')").run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
function checkPin(pin) {
  const salt = getSetting('pin_salt');
  const hash = getSetting('pin_hash');
  if (!salt || !hash) return false;
  const a = Buffer.from(hashPin(pin, salt), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function changePin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('pin_salt', salt);
  setSetting('pin_hash', hashPin(pin, salt));
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = {
  db, tx, ROOT, DATA_DIR, PHOTO_DIR, BACKUP_DIR, DB_PATH,
  getSettings, getSetting, setSetting, checkPin, changePin, DEFAULT_SETTINGS,
};
