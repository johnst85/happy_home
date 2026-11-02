// 작은 UI 도우미: DOM 생성, 토스트, 모달, PIN 패드, 폼
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);

export function avatar(member, size = 'md') {
  const el = h('span', { class: `avatar avatar-${size}`, style: { '--mc': member?.color || '#999' } });
  if (member?.photo) el.append(h('img', { src: member.photo, alt: member.name, draggable: 'false' }));
  else el.append(h('span', { class: 'avatar-emoji' }, member?.emoji || '🙂'));
  return el;
}

// ---------- 토스트
export function toast(msg, { action, actionLabel, duration = 3000, kind = '' } = {}) {
  const host = $('#toasts');
  const bar = h('div', { class: 'toast-bar' });
  const el = h('div', { class: `toast ${kind}` }, h('span', {}, msg));
  if (action) {
    el.append(h('button', { class: 'btn btn-sm btn-light', onclick: () => { action(); close(); } }, actionLabel || '되돌리기'));
    bar.style.animationDuration = `${duration}ms`;
    el.append(bar);
  }
  host.append(el);
  let timer = setTimeout(close, duration);
  function close() {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }
  return close;
}
export const errorToast = (e) => toast(e?.message || String(e), { kind: 'error' });

// ---------- 모달
export function modal(content, { title, wide, onClose, className = '' } = {}) {
  const box = h('div', { class: `modal ${wide ? 'modal-wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true' });
  const back = h('div', { class: 'modal-back' }, box);
  const close = () => {
    back.classList.add('out');
    setTimeout(() => back.remove(), 200);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  if (title) box.append(h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: close }, '✕')));
  const body = h('div', { class: 'modal-body' });
  box.append(body);
  append(body, [typeof content === 'function' ? content(close) : content]);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return close;
}

export function confirmBox(message, { ok = '확인', danger } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = modal((c) => h('div', { class: 'confirm' },
      h('p', {}, message),
      h('div', { class: 'row-end' },
        h('button', { class: 'btn btn-ghost', onclick: () => { done = true; resolve(false); c(); } }, '취소'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { done = true; resolve(true); c(); } }, ok))),
    { onClose: () => { if (!done) resolve(false); } });
    void close;
  });
}

// ---------- PIN 패드
export function pinPad({ title = '부모 PIN', onSubmit }) {
  let value = '';
  let pressFn = () => {};
  const dots = h('div', { class: 'pin-dots' });
  const msg = h('div', { class: 'pin-msg' });
  const render = () => {
    dots.replaceChildren(...Array.from({ length: Math.max(4, value.length) }, (_, i) => h('span', { class: i < value.length ? 'on' : '' })));
  };
  const onKey = (e) => {
    if (/^\d$/.test(e.key)) pressFn(e.key);
    else if (e.key === 'Backspace') pressFn('⌫');
    else if (e.key === 'Enter') pressFn('OK');
  };
  document.addEventListener('keydown', onKey);
  render();
  return modal((close) => {
    pressFn = async (k) => {
      if (k === '⌫') value = value.slice(0, -1);
      else if (k === 'OK') {
        if (value.length < 4) { msg.textContent = '4~6자리를 눌러 주세요'; return; }
        try {
          await onSubmit(value);
          close();
          return;
        } catch (e) {
          msg.textContent = e.message;
          value = '';
          dots.classList.add('shake');
          setTimeout(() => dots.classList.remove('shake'), 400);
        }
      } else if (value.length < 6) value += k;
      render();
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
    return h('div', { class: 'pin' },
      h('div', { class: 'pin-title' }, '🔒 ', title),
      dots, msg,
      h('div', { class: 'pin-keys' }, keys.map((k) => h('button', { class: `pin-key ${k === 'OK' ? 'ok' : ''}`, onclick: () => pressFn(k) }, k))));
  }, { className: 'modal-pin', onClose: () => document.removeEventListener('keydown', onKey) });
}

// ---------- 폼
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const dayNames = DAY_NAMES;

/**
 * fields: [{ key, label, type, options, help, min, max, step, when(values) }]
 * type: text | number | time | date | select | days | members | checkbox | color | textarea | emoji | range
 */
export function form(fields, values = {}, ctx = {}) {
  const state = { ...values };
  const root = h('div', { class: 'form' });
  const rows = [];
  for (const f of fields) {
    const row = h('label', { class: `field field-${f.type || 'text'}` });
    if (f.type !== 'checkbox') row.append(h('span', { class: 'field-label' }, f.label));
    row.append(renderInput(f, state, ctx, refresh));
    if (f.help) row.append(h('small', { class: 'field-help' }, f.help));
    rows.push([f, row]);
    root.append(row);
  }
  function refresh() {
    for (const [f, row] of rows) row.hidden = f.when ? !f.when(state) : false;
  }
  refresh();
  return { el: root, values: state };
}

function renderInput(f, state, ctx, refresh) {
  const set = (v) => { state[f.key] = v; refresh(); };
  const v = state[f.key];
  switch (f.type) {
    case 'select':
      return h('select', { onchange: (e) => set(e.target.value) },
        f.options.map(([val, label]) => h('option', { value: val, selected: String(v ?? '') === String(val) }, label)));
    case 'checkbox':
      return h('span', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: !!Number(v) || v === true, onchange: (e) => set(e.target.checked ? 1 : 0) }),
        h('span', {}, f.label));
    case 'days': {
      const sel = new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).filter((x) => x !== '').map(Number));
      const wrap = h('span', { class: 'chips' });
      DAY_NAMES.forEach((n, i) => {
        const b = h('button', { type: 'button', class: `chip ${sel.has(i) ? 'on' : ''}`, onclick: () => {
          sel.has(i) ? sel.delete(i) : sel.add(i);
          b.classList.toggle('on');
          set([...sel].sort());
        } }, n);
        wrap.append(b);
      });
      const quick = (arr) => () => { sel.clear(); arr.forEach((x) => sel.add(x)); [...wrap.querySelectorAll('.chip')].forEach((c, i) => c.classList.toggle('on', sel.has(i))); set([...sel].sort()); };
      wrap.append(
        h('button', { type: 'button', class: 'chip chip-ghost', onclick: quick([1, 2, 3, 4, 5]) }, '평일'),
        h('button', { type: 'button', class: 'chip chip-ghost', onclick: quick([0, 1, 2, 3, 4, 5, 6]) }, '매일'));
      state[f.key] = [...sel].sort();
      return wrap;
    }
    case 'members': {
      const sel = new Set((v || []).map(Number));
      const wrap = h('span', { class: 'chips' });
      for (const m of ctx.members || []) {
        if (f.filter && !f.filter(m)) continue;
        const b = h('button', { type: 'button', class: `chip chip-member ${sel.has(m.id) ? 'on' : ''}`, style: { '--mc': m.color }, onclick: () => {
          if (f.single) { sel.clear(); wrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); }
          sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id);
          b.classList.toggle('on', sel.has(m.id));
          set([...sel]);
        } }, avatar(m, 'xs'), m.name);
        wrap.append(b);
      }
      state[f.key] = [...sel];
      return wrap;
    }
    case 'emoji': {
      const input = h('input', { type: 'text', value: v ?? '', maxlength: 8, class: 'emoji-input', oninput: (e) => set(e.target.value) });
      const wrap = h('span', { class: 'emoji-pick' }, input);
      if (f.options) {
        const list = h('span', { class: 'emoji-list' });
        for (const e of f.options) list.append(h('button', { type: 'button', class: 'emoji-opt', onclick: () => { input.value = e; set(e); } }, e));
        wrap.append(list);
      }
      return wrap;
    }
    case 'textarea':
      return h('textarea', { rows: f.rows || 4, oninput: (e) => set(e.target.value) }, v ?? '');
    case 'range': {
      const out = h('output', {}, v ?? f.min ?? 0);
      return h('span', { class: 'range-row' },
        h('input', { type: 'range', min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1, value: v ?? f.min ?? 0, oninput: (e) => { out.textContent = e.target.value; set(Number(e.target.value)); } }),
        out);
    }
    case 'number':
      return h('input', { type: 'number', inputmode: 'numeric', value: v ?? '', min: f.min, max: f.max, step: f.step, oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
    default:
      return h('input', { type: f.type || 'text', value: v ?? '', placeholder: f.placeholder, maxlength: f.maxlength, oninput: (e) => set(e.target.value) });
  }
}

/** 폼이 들어간 모달. onSave(values) 가 throw 하면 모달 유지 */
export function formModal({ title, fields, values, ctx, onSave, onDelete, saveLabel = '저장' }) {
  return modal((close) => {
    const f = form(fields, values, ctx);
    const err = h('div', { class: 'form-error' });
    const save = h('button', { class: 'btn btn-primary', onclick: async () => {
      save.disabled = true;
      try { await onSave(f.values); close(); } catch (e) { err.textContent = e.message; } finally { save.disabled = false; }
    } }, saveLabel);
    return h('div', {}, f.el, err,
      h('div', { class: 'row-end' },
        onDelete && h('button', { class: 'btn btn-danger-ghost push-left', onclick: async () => {
          if (!(await confirmBox('정말 삭제할까요?', { ok: '삭제', danger: true }))) return;
          try { await onDelete(); close(); } catch (e) { err.textContent = e.message; }
        } }, '삭제'),
        h('button', { class: 'btn btn-ghost', onclick: close }, '취소'),
        save));
  }, { title });
}

/** 이미지 파일 → 정사각형으로 잘라 리사이즈한 dataURL */
export function pickImage({ size = 320, square = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*' });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const s = square ? Math.min(img.width, img.height) : null;
        const c = document.createElement('canvas');
        if (square) {
          c.width = c.height = size;
          c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          resolve(c.toDataURL('image/jpeg', 0.88));
        } else {
          const r = Math.min(1, size / Math.max(img.width, img.height));
          c.width = Math.round(img.width * r);
          c.height = Math.round(img.height * r);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/png'));
        }
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

export const fmtDate = (s, opt = { month: 'long', day: 'numeric', weekday: 'short' }) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ko-KR', opt);
};
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const nowHm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
