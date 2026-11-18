// API client: adds the session token and active branch to every request.

const TOKEN_KEY = "pos.token";
const BRANCH_KEY = "pos.branch";

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked (private mode) - session only lasts this page */
  }
  return value;
}

let memoryToken = store(TOKEN_KEY);
let memoryBranch = store(BRANCH_KEY);
let onUnauthorized = () => {};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

export const session = {
  get token() {
    return memoryToken;
  },
  set token(value) {
    memoryToken = value;
    store(TOKEN_KEY, value);
  },
  get branchId() {
    return memoryBranch ? Number(memoryBranch) : null;
  },
  set branchId(value) {
    memoryBranch = value ? String(value) : null;
    store(BRANCH_KEY, memoryBranch);
  },
  onUnauthorized(fn) {
    onUnauthorized = fn;
  }
};

export async function api(method, path, body, { branch } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (memoryToken) headers.authorization = `Bearer ${memoryToken}`;
  const branchId = branch === undefined ? memoryBranch : branch;
  if (branchId) headers["x-branch-id"] = String(branchId);
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: { message: "Cannot reach the store server. Check the network connection.", code: "OFFLINE" } });
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const error = new ApiError(res.status, data);
    if (res.status === 401 && memoryToken && !path.startsWith("/api/auth/")) onUnauthorized(error);
    throw error;
  }
  return data;
}

export const get = (path, opts) => api("GET", path, undefined, opts);
export const post = (path, body = {}, opts) => api("POST", path, body, opts);
export const put = (path, body = {}, opts) => api("PUT", path, body, opts);
export const patch = (path, body = {}, opts) => api("PATCH", path, body, opts);
export const del = (path, opts) => api("DELETE", path, undefined, opts);

/** Downloads a CSV export with auth headers. */
export async function download(path, filename, { branch } = {}) {
  const branchId = branch === undefined ? memoryBranch : branch;
  const res = await fetch(path, { headers: { authorization: `Bearer ${memoryToken}`, ...(branchId ? { "x-branch-id": String(branchId) } : {}) } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const str = s.toString();
  return str ? `?${str}` : "";
};
