// 서버 통신 + 부모 토큰 + 실시간(SSE)
const TOKEN_KEY = 'hh_parent_token';

export const auth = {
  get token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  },
  set token(v) {
    try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
  },
  parent: false,
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (auth.token) headers['x-parent-token'] = auth.token;
  let payload;
  if (raw) {
    payload = raw;
    headers['content-type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && auth.parent) {
      auth.parent = false;
      auth.token = '';
      window.dispatchEvent(new CustomEvent('hh:parent', { detail: false }));
    }
    throw new ApiError(res.status, (data && data.error) || `요청 실패 (${res.status})`);
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
export const del = (p) => api(p, { method: 'DELETE' });

export async function login(pin) {
  const r = await post('/api/auth', { pin });
  auth.token = r.token;
  auth.parent = true;
  window.dispatchEvent(new CustomEvent('hh:parent', { detail: true }));
  return r;
}
export async function logout() {
  try { await post('/api/auth/logout'); } catch { /* 무시 */ }
  auth.token = '';
  auth.parent = false;
  window.dispatchEvent(new CustomEvent('hh:parent', { detail: false }));
}

/** SSE 연결. handlers: { [eventName]: fn(data) } */
export function connectStream(handlers) {
  let es;
  const open = () => {
    es = new EventSource('/api/stream');
    for (const [name, fn] of Object.entries(handlers)) {
      if (name === 'open') continue;
      es.addEventListener(name, (e) => {
        try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); }
      });
    }
    es.onopen = () => handlers.open?.();
  };
  open();
  return () => es?.close();
}
