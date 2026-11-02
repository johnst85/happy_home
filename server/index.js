// 우리 가족 하루 체크 — 서버 (Node.js + Express)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const express = require('express');
const cron = require('node-cron');

const {
  db, tx, ROOT, PHOTO_DIR, BACKUP_DIR,
  getSetting, setSetting, checkPin, changePin, DEFAULT_SETTINGS,
} = require('./db');
const L = require('./logic');
const player = require('./player');

const PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const MEDIA_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.mp4', '.webm', '.mov', '.m4v']);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// ------------------------------------------------------------------ 공통
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const str = (v, max = 200) => (v == null ? null : String(v).slice(0, max));
const time = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);
const daysStr = (v) => {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
  const set = [...new Set(arr.map(Number).filter((n) => n >= 0 && n <= 6))].sort();
  return set.join(',');
};

function mediaDir() {
  const d = getSetting('media_dir') || 'media';
  const abs = path.isAbsolute(d) ? d : path.join(ROOT, d);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}
function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  if (!base || base.startsWith('.')) fail(400, '파일 이름이 올바르지 않아요');
  return base;
}

// ------------------------------------------------------------------ 부모 인증 (PIN)
const tokens = new Map(); // token -> expiresAt
const TOKEN_TTL = 15 * 60 * 1000;
let pinFails = 0;
let pinLockedUntil = 0;

function isParent(req) {
  const t = req.get('x-parent-token');
  if (!t || !tokens.has(t)) return false;
  if (tokens.get(t) < Date.now()) { tokens.delete(t); return false; }
  tokens.set(t, Date.now() + TOKEN_TTL);
  return true;
}
function requireParent(req, _res, next) {
  if (!isParent(req)) return next(new HttpError(401, '부모 PIN이 필요해요'));
  next();
}

app.post('/api/auth', (req, res) => {
  if (Date.now() < pinLockedUntil) fail(429, '잠시 후 다시 시도해 주세요');
  if (!checkPin(String(req.body?.pin ?? ''))) {
    pinFails++;
    if (pinFails >= 5) { pinLockedUntil = Date.now() + 30_000; pinFails = 0; }
    fail(403, 'PIN이 맞지 않아요');
  }
  pinFails = 0;
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL);
  res.json({ token, ttl: TOKEN_TTL });
});
app.post('/api/auth/logout', (req, res) => {
  tokens.delete(req.get('x-parent-token'));
  res.json({ ok: true });
});
app.get('/api/auth/check', (req, res) => res.json({ parent: isParent(req) }));

// ------------------------------------------------------------------ 실시간 반영 (SSE)
const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
function broadcast(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25_000).unref();
const changed = (what) => broadcast('changed', { what });

// ------------------------------------------------------------------ 기본 데이터
function tasksOut() {
  return L.loadTasks().map(({ dayset, ...t }) => ({ ...t, days: [...dayset].sort() }));
}
app.get('/api/bootstrap', (req, res) => {
  res.json({
    today: L.ymd(),
    now: new Date().toISOString(),
    members: L.loadMembers(),
    slots: db.prepare('SELECT * FROM time_slots ORDER BY start_time, sort, id').all(),
    tasks: tasksOut(),
    settings: L.publicSettings(),
    parent: isParent(req),
  });
});

app.get('/api/today', (req, res) => {
  const today = L.ymd();
  const members = L.loadMembers();
  const st = L.statusRange(L.addDays(today, -180), today, { members });
  // 앱을 처음 쓰기 시작한 날 이전은 "못 한 날"로 치지 않음
  const firstDay = db.prepare('SELECT MIN(date) AS d FROM completions').get().d || today;
  const streaks = {};
  const rest = {};
  const yesterday = {};
  for (const m of members) {
    streaks[m.id] = L.streakFor(m.id, today, st);
    rest[m.id] = L.restInfo(m.id, today);
    // 최근 7일 중 못 채운 날(쉬어가기권 사용 가능)
    const missed = [];
    for (let i = 1; i <= 7; i++) {
      const d = L.addDays(today, -i);
      const s = st[d]?.[m.id];
      if (d >= firstDay && s && s.scheduled > 0 && !s.achieved && !s.rest) missed.push(d);
    }
    yesterday[m.id] = { status: st[L.addDays(today, -1)]?.[m.id] || null, missed };
  }
  const periodType = getSetting('reward_period') || 'week';
  const period = L.getPeriod(periodType, today, 0);
  const pts = L.pointsBetween(period.start, period.end);
  const famPts = Object.values(pts).reduce((a, b) => a + b, 0);
  const famRewards = db.prepare("SELECT * FROM rewards WHERE target = 'family' AND period = ? ORDER BY threshold").all(periodType);
  res.json({
    date: today,
    time: L.hm(),
    completions: db.prepare('SELECT * FROM completions WHERE date = ? ORDER BY checked_at').all(today),
    status: st[today],
    streaks,
    rest,
    yesterday,
    events: L.eventsBetween(today, today),
    period: { ...period, points: pts, family: famPts, family_rewards: famRewards },
    new_grants: grantsQuery('WHERE g.celebrated = 0 ORDER BY g.id', []),
    lifetime: L.pointsBetween('0000-01-01', '9999-12-31'),
  });
});

// ------------------------------------------------------------------ 할 일 체크
app.post('/api/completions', (req, res) => {
  const today = L.ymd();
  const now = L.hm();
  const taskId = int(req.body?.task_id);
  const memberId = int(req.body?.member_id);
  const task = L.loadTasks().find((t) => t.id === taskId);
  if (!task || !task.active) fail(404, '할 일을 찾을 수 없어요');
  if (!task.assignees.includes(memberId)) fail(403, '이 구성원의 할 일이 아니에요');
  if (!task.dayset.has(L.weekday(today))) fail(400, '오늘은 쉬는 할 일이에요');
  const parent = isParent(req);

  const exists = task.is_family
    ? db.prepare('SELECT id FROM completions WHERE task_id = ? AND date = ?').get(taskId, today)
    : db.prepare('SELECT id FROM completions WHERE task_id = ? AND member_id = ? AND date = ?').get(taskId, memberId, today);
  if (exists) fail(409, '이미 완료했어요');

  const late = !!(task.deadline && now > task.deadline);
  if (late && getSetting('late_allowed') !== '1' && !parent) fail(403, '마감이 지났어요');
  const ratio = Math.max(0, Math.min(1, Number(getSetting('late_ratio') || 0.5)));
  const points = late ? Math.round(task.points * ratio) : task.points;
  let method = ['touch', 'face', 'proxy'].includes(req.body?.method) ? req.body.method : 'touch';
  if (method === 'proxy' && !parent) method = 'touch';

  const r = db.prepare(`INSERT INTO completions (task_id, member_id, date, checked_at, method, points, is_late)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(taskId, memberId, today, new Date().toISOString(), method, points, late ? 1 : 0);
  const completion = db.prepare('SELECT * FROM completions WHERE id = ?').get(r.lastInsertRowid);

  // 축하 판정
  const tasks = L.loadTasks();
  const members = L.loadMembers();
  const st = L.statusRange(today, today, { tasks, members })[today];
  const comps = db.prepare('SELECT task_id, member_id FROM completions WHERE date = ?').all(today);
  const wd = L.weekday(today);
  const isDone = (t, mid) => comps.some((c) => c.task_id === t.id && (t.is_family || c.member_id === mid));
  const slotTasks = tasks.filter((t) => t.active && t.slot_id === task.slot_id && t.dayset.has(wd) && t.assignees.includes(memberId));
  const slotCleared = slotTasks.length > 0 && slotTasks.every((t) => isDone(t, memberId));
  const withTasks = members.filter((m) => st[m.id]?.scheduled > 0);
  const familyCleared = withTasks.length > 0 && withTasks.every((m) => st[m.id].achieved);

  const payload = {
    completion,
    task: { id: task.id, name: task.name, icon: task.icon, is_family: task.is_family },
    slot_cleared: slotCleared,
    day_cleared: !!st[memberId]?.achieved,
    family_cleared: familyCleared,
  };
  broadcast('completion', payload);
  res.json(payload);
});

app.delete('/api/completions/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM completions WHERE id = ?').get(int(req.params.id));
  if (!c) fail(404, '기록이 없어요');
  const age = Date.now() - Date.parse(c.checked_at);
  if (age > 8000 && !isParent(req)) fail(401, '5초가 지나면 부모님만 취소할 수 있어요');
  db.prepare('DELETE FROM completions WHERE id = ?').run(c.id);
  broadcast('uncheck', { id: c.id, task_id: c.task_id, member_id: c.member_id });
  res.json({ ok: true });
});

// 쉬어가기권
app.post('/api/rest', (req, res) => {
  const today = L.ymd();
  const memberId = int(req.body?.member_id);
  const date = req.body?.date;
  if (!L.isYmd(date) || date >= today || date < L.addDays(today, -7)) fail(400, '최근 7일 안의 지난 날만 쓸 수 있어요');
  const info = L.restInfo(memberId, today);
  if (info.left <= 0) fail(400, '이번 주 쉬어가기권을 이미 썼어요');
  db.prepare('INSERT OR IGNORE INTO rest_days (member_id, date) VALUES (?, ?)').run(memberId, date);
  changed('rest');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ 점수 현황
app.get('/api/scores', (req, res) => {
  const today = L.ymd();
  const type = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : (getSetting('reward_period') || 'week');
  const offset = Math.min(0, int(req.query.offset, 0));
  const p = L.getPeriod(type, today, offset);
  const members = L.loadMembers();
  const pts = L.pointsBetween(p.start, p.end);
  const until = p.end < today ? p.end : today;
  const st = p.start <= until ? L.statusRange(p.start, until, { members }) : {};
  const grants = db.prepare('SELECT * FROM reward_grants WHERE period_start = ? AND period = ?').all(p.start, type);
  const out = members.map((m) => {
    let done = 0;
    let scheduled = 0;
    for (const d of Object.values(st)) { done += d[m.id].done; scheduled += d[m.id].scheduled; }
    const rewards = L.rewardsFor(m.id, type, members).map((r) => ({
      ...r, grant: grants.find((g) => g.reward_id === r.id && g.member_id === m.id) || null,
    }));
    return { id: m.id, points: pts[m.id] || 0, done, scheduled, rewards };
  });
  const famRewards = db.prepare("SELECT * FROM rewards WHERE target = 'family' AND period = ? ORDER BY threshold").all(type)
    .map((r) => ({ ...r, grant: grants.find((g) => g.reward_id === r.id && g.member_id === 0) || null }));
  res.json({
    period: p,
    finished: p.end < today,
    members: out,
    family: { points: Object.values(pts).reduce((a, b) => a + b, 0), rewards: famRewards },
  });
});

app.get('/api/scores/trend', (req, res) => {
  const today = L.ymd();
  const members = L.loadMembers();
  const labels = [];
  const series = Object.fromEntries(members.map((m) => [m.id, []]));
  if (req.query.mode === 'weeks') {
    for (let off = -3; off <= 0; off++) {
      const p = L.getPeriod('week', today, off);
      labels.push(off === 0 ? '이번 주' : p.range.split(' ~ ')[0]);
      const pts = L.pointsBetween(p.start, p.end);
      for (const m of members) series[m.id].push(pts[m.id] || 0);
    }
  } else {
    const wk = ['일', '월', '화', '수', '목', '금', '토'];
    for (let i = 6; i >= 0; i--) {
      const d = L.addDays(today, -i);
      labels.push(i === 0 ? '오늘' : `${L.parseYmd(d).getDate()}(${wk[L.weekday(d)]})`);
      const pts = L.pointsBetween(d, d);
      for (const m of members) series[m.id].push(pts[m.id] || 0);
    }
  }
  res.json({ labels, series });
});

function grantsQuery(where, params) {
  return db.prepare(`SELECT g.*, r.content, r.threshold, r.target, m.name AS member_name
    FROM reward_grants g JOIN rewards r ON r.id = g.reward_id LEFT JOIN members m ON m.id = g.member_id ${where}`).all(...params);
}
app.get('/api/grants', (req, res) => {
  res.json(grantsQuery('ORDER BY g.period_start DESC, g.id DESC LIMIT ?', [Math.min(200, int(req.query.limit, 50))]));
});
app.post('/api/grants/:id/pay', requireParent, (req, res) => {
  const paid = req.body?.granted === false ? 0 : 1;
  db.prepare('UPDATE reward_grants SET granted = ?, granted_at = ? WHERE id = ?').run(paid, paid ? L.ymd() : null, int(req.params.id));
  changed('grants');
  res.json({ ok: true });
});
app.post('/api/grants/seen', (req, res) => {
  const ids = (req.body?.ids || []).map((x) => int(x));
  const st = db.prepare('UPDATE reward_grants SET celebrated = 1 WHERE id = ?');
  for (const id of ids) st.run(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ 가족 달력
app.get('/api/calendar', (req, res) => {
  const { start, end } = req.query;
  if (!L.isYmd(start) || !L.isYmd(end) || end < start) fail(400, '기간이 올바르지 않아요');
  const today = L.ymd();
  const until = end < today ? end : today;
  const stamps = {};
  if (start <= until) {
    const st = L.statusRange(start, until);
    for (const [d, day] of Object.entries(st)) {
      stamps[d] = Object.fromEntries(Object.entries(day).map(([mid, s]) => [mid, s.achieved ? 'star' : s.rest ? 'rest' : s.done > 0 ? 'some' : '']));
    }
  }
  res.json({ events: L.eventsBetween(start, end), stamps });
});

function eventInput(b) {
  const title = str(b?.title, 100)?.trim();
  if (!title) fail(400, '제목을 입력해 주세요');
  if (!L.isYmd(b.date)) fail(400, '날짜가 올바르지 않아요');
  const allDay = bool(b.all_day);
  return {
    title,
    date: b.date,
    start_time: allDay ? null : time(b.start_time),
    end_time: allDay ? null : time(b.end_time),
    all_day: allDay,
    repeat: ['none', 'weekly', 'monthly'].includes(b.repeat) ? b.repeat : 'none',
    memo: str(b.memo, 1000),
    icon: str(b.icon, 16) || '📌',
    notify: bool(b.notify),
    notify_before: Math.max(0, Math.min(1440, int(b.notify_before, 10))),
    members: [...new Set((b.members || []).map((x) => int(x)))],
  };
}
function canEditEvent(req, memberIds) {
  if (isParent(req)) return true;
  if (getSetting('child_events') !== '1') return false;
  if (memberIds.length !== 1) return false;
  const m = db.prepare('SELECT role FROM members WHERE id = ?').get(memberIds[0]);
  return m?.role === 'child';
}
function saveEventMembers(id, members) {
  db.prepare('DELETE FROM event_members WHERE event_id = ?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO event_members (event_id, member_id) VALUES (?, ?)');
  for (const m of members) ins.run(id, m);
}
app.post('/api/events', (req, res) => {
  const e = eventInput(req.body);
  if (!canEditEvent(req, e.members)) fail(401, '부모 PIN이 필요해요');
  const id = tx(() => {
    const r = db.prepare(`INSERT INTO events (title, date, start_time, end_time, all_day, repeat, memo, icon, notify, notify_before)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.title, e.date, e.start_time, e.end_time, e.all_day, e.repeat, e.memo, e.icon, e.notify, e.notify_before);
    saveEventMembers(r.lastInsertRowid, e.members);
    return r.lastInsertRowid;
  });
  changed('events');
  res.json({ id });
});
app.put('/api/events/:id', (req, res) => {
  const id = int(req.params.id);
  const old = db.prepare('SELECT member_id FROM event_members WHERE event_id = ?').all(id).map((r) => r.member_id);
  const e = eventInput(req.body);
  if (!canEditEvent(req, old) || !canEditEvent(req, e.members)) fail(401, '부모 PIN이 필요해요');
  tx(() => {
    db.prepare(`UPDATE events SET title=?, date=?, start_time=?, end_time=?, all_day=?, repeat=?, memo=?, icon=?, notify=?, notify_before=? WHERE id=?`)
      .run(e.title, e.date, e.start_time, e.end_time, e.all_day, e.repeat, e.memo, e.icon, e.notify, e.notify_before, id);
    saveEventMembers(id, e.members);
  });
  changed('events');
  res.json({ ok: true });
});
app.delete('/api/events/:id', (req, res) => {
  const id = int(req.params.id);
  const old = db.prepare('SELECT member_id FROM event_members WHERE event_id = ?').all(id).map((r) => r.member_id);
  if (!canEditEvent(req, old)) fail(401, '부모 PIN이 필요해요');
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  changed('events');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ 설정 (부모 전용)
const P = requireParent;

// 구성원
function memberInput(b) {
  const name = str(b?.name, 30)?.trim();
  if (!name) fail(400, '이름을 입력해 주세요');
  return {
    name,
    role: b.role === 'parent' ? 'parent' : 'child',
    emoji: str(b.emoji, 16) || '🙂',
    color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#4f8cff',
    sort: int(b.sort, 0),
  };
}
app.post('/api/members', P, (req, res) => {
  const m = memberInput(req.body);
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM members').get().s;
  const r = db.prepare('INSERT INTO members (name, role, emoji, color, sort) VALUES (?, ?, ?, ?, ?)').run(m.name, m.role, m.emoji, m.color, sort);
  changed('members');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/members/:id', P, (req, res) => {
  const m = memberInput(req.body);
  db.prepare('UPDATE members SET name=?, role=?, emoji=?, color=? WHERE id=?').run(m.name, m.role, m.emoji, m.color, int(req.params.id));
  changed('members');
  res.json({ ok: true });
});
app.delete('/api/members/:id', P, (req, res) => {
  const id = int(req.params.id);
  const m = db.prepare('SELECT photo, character FROM members WHERE id = ?').get(id);
  db.prepare('DELETE FROM members WHERE id = ?').run(id);
  db.prepare('DELETE FROM reward_grants WHERE member_id = ?').run(id);
  for (const f of [m?.photo, m?.character]) removePhoto(f);
  changed('members');
  res.json({ ok: true });
});
function removePhoto(f) {
  if (!f) return;
  const p = path.join(PHOTO_DIR, path.basename(f));
  fs.rm(p, { force: true }, () => {});
}
app.post('/api/members/:id/photo', P, (req, res) => {
  const id = int(req.params.id);
  const kind = req.body?.kind === 'character' ? 'character' : 'photo';
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) fail(404, '구성원이 없어요');
  if (req.body?.dataUrl === null) {
    removePhoto(m[kind]);
    db.prepare(`UPDATE members SET ${kind} = NULL WHERE id = ?`).run(id);
    changed('members');
    return res.json({ ok: true });
  }
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(req.body?.dataUrl || '');
  if (!match) fail(400, '이미지 형식이 올바르지 않아요');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const file = `m${id}-${kind}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, file), Buffer.from(match[2], 'base64'));
  removePhoto(m[kind]);
  db.prepare(`UPDATE members SET ${kind} = ? WHERE id = ?`).run(`/photos/${file}`, id);
  changed('members');
  res.json({ url: `/photos/${file}` });
});
app.put('/api/members-order', P, (req, res) => {
  const st = db.prepare('UPDATE members SET sort = ? WHERE id = ?');
  tx(() => (req.body?.ids || []).forEach((id, i) => st.run(i + 1, int(id))));
  changed('members');
  res.json({ ok: true });
});
app.delete('/api/face-data', P, (req, res) => {
  db.prepare('UPDATE members SET face_descriptor = NULL').run();
  changed('members');
  res.json({ ok: true });
});

// 시간대
function slotInput(b) {
  const name = str(b?.name, 30)?.trim();
  if (!name) fail(400, '이름을 입력해 주세요');
  const s = time(b.start_time);
  const e = time(b.end_time);
  if (!s || !e) fail(400, '시각을 확인해 주세요');
  return { name, start_time: s, end_time: e };
}
app.post('/api/slots', P, (req, res) => {
  const s = slotInput(req.body);
  const r = db.prepare('INSERT INTO time_slots (name, start_time, end_time) VALUES (?, ?, ?)').run(s.name, s.start_time, s.end_time);
  changed('slots');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/slots/:id', P, (req, res) => {
  const s = slotInput(req.body);
  db.prepare('UPDATE time_slots SET name=?, start_time=?, end_time=? WHERE id=?').run(s.name, s.start_time, s.end_time, int(req.params.id));
  changed('slots');
  res.json({ ok: true });
});
app.delete('/api/slots/:id', P, (req, res) => {
  db.prepare('DELETE FROM time_slots WHERE id = ?').run(int(req.params.id));
  changed('slots');
  res.json({ ok: true });
});

// 할 일
function taskInput(b) {
  const name = str(b?.name, 60)?.trim();
  if (!name) fail(400, '이름을 입력해 주세요');
  const days = daysStr(b.days);
  if (!days) fail(400, '반복 요일을 하나 이상 골라 주세요');
  const assignees = [...new Set((b.assignees || []).map((x) => int(x)))];
  if (!assignees.length) fail(400, '담당 구성원을 골라 주세요');
  return {
    name,
    icon: str(b.icon, 16) || '✅',
    points: Math.max(0, Math.min(1000, int(b.points, 10))),
    slot_id: b.slot_id ? int(b.slot_id) : null,
    deadline: time(b.deadline),
    days,
    is_family: bool(b.is_family),
    active: b.active === undefined ? 1 : bool(b.active),
    assignees,
  };
}
function saveAssignees(id, list) {
  db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, member_id) VALUES (?, ?)');
  for (const m of list) ins.run(id, m);
}
app.post('/api/tasks', P, (req, res) => {
  const t = taskInput(req.body);
  const id = tx(() => {
    const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 AS s FROM tasks').get().s;
    const r = db.prepare('INSERT INTO tasks (name, icon, points, slot_id, deadline, days, is_family, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(t.name, t.icon, t.points, t.slot_id, t.deadline, t.days, t.is_family, t.active, sort);
    saveAssignees(r.lastInsertRowid, t.assignees);
    return r.lastInsertRowid;
  });
  changed('tasks');
  res.json({ id });
});
app.put('/api/tasks/:id', P, (req, res) => {
  const t = taskInput(req.body);
  const id = int(req.params.id);
  tx(() => {
    db.prepare('UPDATE tasks SET name=?, icon=?, points=?, slot_id=?, deadline=?, days=?, is_family=?, active=? WHERE id=?')
      .run(t.name, t.icon, t.points, t.slot_id, t.deadline, t.days, t.is_family, t.active, id);
    saveAssignees(id, t.assignees);
  });
  changed('tasks');
  res.json({ ok: true });
});
app.delete('/api/tasks/:id', P, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(int(req.params.id));
  changed('tasks');
  res.json({ ok: true });
});
app.put('/api/tasks-order', P, (req, res) => {
  const st = db.prepare('UPDATE tasks SET sort = ? WHERE id = ?');
  tx(() => (req.body?.ids || []).forEach((id, i) => st.run(i + 1, int(id))));
  changed('tasks');
  res.json({ ok: true });
});

// 보상
app.get('/api/rewards', (req, res) => res.json(db.prepare('SELECT * FROM rewards ORDER BY target DESC, period, threshold').all()));
function rewardInput(b) {
  const content = str(b?.content, 100)?.trim();
  if (!content) fail(400, '보상 내용을 입력해 주세요');
  const target = b.target === 'family' ? 'family' : 'member';
  return {
    target,
    member_id: target === 'member' && b.member_id ? int(b.member_id) : null,
    period: ['day', 'week', 'month'].includes(b.period) ? b.period : 'week',
    threshold: Math.max(1, int(b.threshold, 100)),
    content,
  };
}
app.post('/api/rewards', P, (req, res) => {
  const r = rewardInput(req.body);
  const out = db.prepare('INSERT INTO rewards (target, member_id, period, threshold, content) VALUES (?, ?, ?, ?, ?)').run(r.target, r.member_id, r.period, r.threshold, r.content);
  changed('rewards');
  res.json({ id: out.lastInsertRowid });
});
app.put('/api/rewards/:id', P, (req, res) => {
  const r = rewardInput(req.body);
  db.prepare('UPDATE rewards SET target=?, member_id=?, period=?, threshold=?, content=? WHERE id=?').run(r.target, r.member_id, r.period, r.threshold, r.content, int(req.params.id));
  changed('rewards');
  res.json({ ok: true });
});
app.delete('/api/rewards/:id', P, (req, res) => {
  db.prepare('DELETE FROM rewards WHERE id = ?').run(int(req.params.id));
  changed('rewards');
  res.json({ ok: true });
});

// 일반 설정
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'last_settled');
app.put('/api/settings', P, (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!SETTING_KEYS.includes(k)) continue;
    setSetting(k, Array.isArray(v) ? JSON.stringify(v.map((x) => String(x).slice(0, 100)).slice(0, 30)) : String(v).slice(0, 500));
  }
  changed('settings');
  res.json({ settings: L.publicSettings() });
});
app.put('/api/pin', P, (req, res) => {
  const pin = String(req.body?.pin ?? '');
  if (!/^\d{4,6}$/.test(pin)) fail(400, 'PIN은 숫자 4~6자리예요');
  changePin(pin);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ 미디어
app.get('/api/media', P, (req, res) => {
  const dir = mediaDir();
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && MEDIA_EXT.has(path.extname(f.name).toLowerCase()))
    .map((f) => ({ name: f.name, size: fs.statSync(path.join(dir, f.name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  res.json({ dir, files });
});
app.post('/api/media', P, express.raw({ type: () => true, limit: '1gb' }), (req, res) => {
  const name = safeName(req.query.name);
  if (!MEDIA_EXT.has(path.extname(name).toLowerCase())) fail(400, '지원하지 않는 파일 형식이에요');
  fs.writeFileSync(path.join(mediaDir(), name), req.body);
  res.json({ name });
});
app.delete('/api/media/:name', P, (req, res) => {
  fs.rmSync(path.join(mediaDir(), safeName(req.params.name)), { force: true });
  res.json({ ok: true });
});
app.use('/media-files', (req, res, next) => express.static(mediaDir(), { fallthrough: false })(req, res, next));

async function playMedia({ file, location, volume }) {
  const name = safeName(file);
  const abs = path.join(mediaDir(), name);
  if (!fs.existsSync(abs)) return { ok: false, error: '파일이 없어요' };
  if (location === 'tablet') {
    broadcast('media', { url: `/media-files/${encodeURIComponent(name)}`, name, volume: int(volume, 70) });
    return { ok: true, devices: clients.size };
  }
  return player.play(abs, volume);
}
app.post('/api/media/play', P, async (req, res) => {
  res.json(await playMedia(req.body || {}));
});
app.post('/api/media/stop', P, (req, res) => {
  player.stop();
  broadcast('media-stop', {});
  res.json({ ok: true });
});

app.get('/api/media-schedules', P, (req, res) => res.json(db.prepare('SELECT * FROM media_schedules ORDER BY time').all()));
function mediaInput(b) {
  const t = time(b?.time);
  if (!t) fail(400, '시각을 확인해 주세요');
  if (!b.file) fail(400, '파일을 골라 주세요');
  return {
    label: str(b.label, 60),
    time: t,
    days: daysStr(b.days) || '0,1,2,3,4,5,6',
    file: safeName(b.file),
    location: b.location === 'tablet' ? 'tablet' : 'server',
    volume: Math.max(0, Math.min(100, int(b.volume, 70))),
    active: b.active === undefined ? 1 : bool(b.active),
  };
}
app.post('/api/media-schedules', P, (req, res) => {
  const m = mediaInput(req.body);
  const r = db.prepare('INSERT INTO media_schedules (label, time, days, file, location, volume, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(m.label, m.time, m.days, m.file, m.location, m.volume, m.active);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/media-schedules/:id', P, (req, res) => {
  const m = mediaInput(req.body);
  db.prepare('UPDATE media_schedules SET label=?, time=?, days=?, file=?, location=?, volume=?, active=? WHERE id=?')
    .run(m.label, m.time, m.days, m.file, m.location, m.volume, m.active, int(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/media-schedules/:id', P, (req, res) => {
  db.prepare('DELETE FROM media_schedules WHERE id = ?').run(int(req.params.id));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ 백업·복원
const TABLES = ['members', 'time_slots', 'tasks', 'task_assignees', 'completions', 'rewards', 'reward_grants',
  'events', 'event_members', 'media_schedules', 'rest_days', 'settings'];

app.get('/api/backup/export', P, (req, res) => {
  const tables = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  res.set('Content-Disposition', `attachment; filename="happy-home-backup-${L.ymd()}.json"`);
  res.json({ app: 'happy-home', version: 1, exported_at: new Date().toISOString(), tables });
});
app.post('/api/backup/import', P, (req, res) => {
  const data = req.body;
  if (data?.app !== 'happy-home' || !data.tables) fail(400, '백업 파일이 올바르지 않아요');
  backupNow('before-import');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    tx(() => {
      for (const t of TABLES) {
        const rows = data.tables[t];
        if (!Array.isArray(rows)) continue;
        db.prepare(`DELETE FROM ${t}`).run();
        const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
        for (const row of rows) {
          const keys = Object.keys(row).filter((k) => cols.includes(k));
          if (!keys.length) continue;
          db.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
        }
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  changed('all');
  res.json({ ok: true });
});
function backupNow(tag = '') {
  const file = path.join(BACKUP_DIR, `happy-${L.ymd()}${tag ? `-${tag}-${Date.now()}` : ''}.db`);
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  // 최근 30개만 보관
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('happy-') && f.endsWith('.db')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  return path.basename(file);
}
app.post('/api/backup/now', P, (req, res) => res.json({ file: backupNow() }));

// ------------------------------------------------------------------ 정적 파일
app.use('/photos', express.static(PHOTO_DIR, { maxAge: '30d', fallthrough: false }));
app.use(express.static(path.join(ROOT, 'public'), {
  setHeaders(res, p) {
    if (p.endsWith('sw.js') || p.endsWith('.html')) res.set('Cache-Control', 'no-cache');
  },
}));
app.use('/api', (req, res) => res.status(404).json({ error: '없는 주소예요' }));

// 에러 처리
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? '서버 오류가 났어요' : err.message });
});

// ------------------------------------------------------------------ 예약 작업 (node-cron)
function everyMinute() {
  const now = new Date();
  const today = L.ymd(now);
  const t = L.hm(now);
  const wd = now.getDay();

  // 1) 기간 정산
  try {
    const n = L.settle(today);
    if (n > 0) broadcast('grants', { created: n });
  } catch (e) { console.error('[settle]', e); }

  // 2) 예약 미디어 재생
  for (const s of db.prepare('SELECT * FROM media_schedules WHERE active = 1 AND time = ?').all(t)) {
    if (!s.days.split(',').map(Number).includes(wd)) continue;
    playMedia(s).then((r) => console.log(`[media] ${t} ${s.file} → ${s.location}`, r.ok ? 'OK' : r.error));
  }

  // 3) 일정 알림
  if (getSetting('event_alerts') === '1') {
    for (const e of L.eventsBetween(today, L.addDays(today, 1))) {
      if (!e.notify || e.all_day || !e.start_time) continue;
      const [h, m] = e.start_time.split(':').map(Number);
      const start = L.parseYmd(e.occurs);
      start.setHours(h, m - (e.notify_before || 0), 0, 0);
      if (L.ymd(start) === today && L.hm(start) === t) {
        broadcast('alert', { title: e.title, icon: e.icon, start_time: e.start_time, members: e.members, before: e.notify_before });
      }
    }
  }
  broadcast('tick', { today, time: t });
}
cron.schedule('* * * * *', everyMinute);
cron.schedule('0 3 * * *', () => {
  try { console.log('[backup]', backupNow()); } catch (e) { console.error('[backup]', e); }
});
setTimeout(() => { try { L.settle(); } catch (e) { console.error(e); } }, 1000);

// ------------------------------------------------------------------ 서버 시작
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}
http.createServer(app).listen(PORT, () => {
  console.log(`\n🏠 우리 가족 하루 체크 서버가 시작됐어요`);
  console.log(`   이 PC:      http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`   집 네트워크: http://${ip}:${PORT}`);
});
const certDir = path.join(ROOT, 'certs');
const certFile = path.join(certDir, 'cert.pem');
const keyFile = path.join(certDir, 'key.pem');
if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, app).listen(HTTPS_PORT, () => {
    for (const ip of lanAddresses()) console.log(`   HTTPS:      https://${ip}:${HTTPS_PORT}`);
  });
}
