/* Thin API client. Holds the access token in memory and refreshes it once on
   a 401 before giving up, so a long session doesn't drop you at the login
   screen mid-task. */

const BASE = '/api/v1';

let accessToken = null;
let refreshToken = null;
let onLogout = () => {};

export const setOnLogout = (fn) => { onLogout = fn; };
export const getToken = () => accessToken;

function setSession(data) {
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  return data;
}

export function clearSession() {
  accessToken = null;
  refreshToken = null;
}

async function raw(path, { method = 'GET', body, auth = true } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Cannot reach the API. Is the backend running on port 4000?');
    err.status = 0;
    throw err;
  }

  // A dead backend behind the dev proxy answers with HTML or nothing at all,
  // so never assume the body is JSON.
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const err = new Error(
        res.ok
          ? 'The API returned a response that was not JSON.'
          : 'Cannot reach the API. Is the backend running on port 4000?'
      );
      err.status = res.status;
      throw err;
    }
  }

  if (!res.ok) {
    const err = new Error(json?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = json?.error?.code;
    err.details = json?.error?.details;
    throw err;
  }
  return json;
}

async function request(path, opts = {}) {
  try {
    return await raw(path, opts);
  } catch (err) {
    if (err.status !== 401 || !refreshToken || opts._retried) {
      if (err.status === 401) { clearSession(); onLogout(); }
      throw err;
    }
    // one silent refresh, then replay the original call
    try {
      const res = await raw('/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false });
      setSession(res.data);
    } catch {
      clearSession();
      onLogout();
      throw err;
    }
    return raw(path, { ...opts, _retried: true });
  }
}

export const api = {
  async login(email, password) {
    const res = await raw('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    return setSession(res.data);
  },

  async logout() {
    if (refreshToken) await raw('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }).catch(() => {});
    clearSession();
  },

  /** Walks every page so the console holds the full population in memory.
      Fine into the low tens of thousands; past that, push filters server-side. */
  async fetchAllUsers({ pageSize = 200, maxPages = 40, onProgress } = {}) {
    const out = [];
    let page = 1;
    let total = 0;
    for (; page <= maxPages; page += 1) {
      // No status filter: the API already excludes soft-deleted users, and the
      // console wants suspended accounts visible so they can be filtered locally.
      const res = await request(`/users?page=${page}&limit=${pageSize}&sort=-createdAt`);
      out.push(...res.data);
      total = res.meta?.total ?? out.length;
      onProgress?.(out.length, total);
      if (!res.meta?.hasNext) break;
    }
    return { users: out, total };
  },

  overview: () => request('/users/overview').then((r) => r.data),
  userDetail: (id) => request(`/users/${id}`).then((r) => r.data),
  cohorts: () => request('/cohorts?limit=100').then((r) => r.data),
  quickSend: (payload) => request('/campaigns/quick-send', { method: 'POST', body: payload }).then((r) => r.data),
  health: () => raw('/system/health', { auth: false }),
};
