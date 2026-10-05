// Saari API calls yahin se jaati hain. Pages me direct fetch nahi.
export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "http://localhost:8000";

export class ApiError extends Error {
  constructor(code, message, status = 0, requestId = null, details = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

let provider = { getAccessToken: () => null, refresh: null };

export function setTokenProvider(p) {
  provider = { getAccessToken: () => null, refresh: null, ...p };
}

async function send(path, { method = "GET", body, headers = {}, signal } = {}) {
  const h = { ...headers };
  const token = provider.getAccessToken();
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h["Content-Type"] = "application/json";
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError("NETWORK_ERROR", "Network request failed", 0);
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null; // body JSON nahi tha
  }
}

function toApiError(res, json) {
  return new ApiError(
    json?.error?.code || "INTERNAL_ERROR",
    json?.error?.message || `Request failed (${res.status})`,
    res.status,
    json?.requestId ?? null,
    json?.error?.details ?? null,
  );
}

// 401 TOKEN_EXPIRED par ek baar refresh karke retry
async function withRefresh(doRequest) {
  try {
    return await doRequest();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.code === "TOKEN_EXPIRED" && provider.refresh) {
      await provider.refresh();
      return doRequest();
    }
    throw e;
  }
}

export function apiRequest(path, opts = {}) {
  return withRefresh(async () => {
    const res = await send(path, opts);
    const json = await readJson(res);
    if (!res.ok || json?.error) throw toApiError(res, json);
    return json ? json.data : null;
  });
}

// CSV jaisi non-envelope responses ke liye
export function apiDownload(path, opts = {}) {
  return withRefresh(async () => {
    const res = await send(path, opts);
    if (!res.ok) throw toApiError(res, await readJson(res));
    return res.blob();
  });
}
