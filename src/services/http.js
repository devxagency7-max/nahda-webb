/* --------------------------------------------------------------------------
   UNIFIED HTTP CLIENT
   Every backend call in the app goes through `request()`. Responsibilities:
     - build the URL (base + path + query)
     - attach Authorization / X-Client-Type / Idempotency-Key headers
     - unwrap the {success,data|error} envelope (WEB_API_DOCUMENTATION.md §3)
     - on 401: refresh once (serialized across concurrent callers) and retry
       the original request exactly once; on repeated failure, force logout
     - never retry on 403 (it is never solved by refreshing — §2.5)
     - abort any request that exceeds the timeout (config/env.js API_TIMEOUT_MS)
       and throw RequestTimeoutError, so screens can show an error + retry
       instead of loading forever
   -------------------------------------------------------------------------- */
import { API_BASE_URL, API_TIMEOUT_MS } from '../config/env.js';
import { TokenStore } from './tokens.js';
import { ApiError, NetworkError, RequestTimeoutError } from './errors.js';
import { EventBus, EVENTS } from '../core/event-bus.js';

// Routes that must NOT go through the auth/401-retry machinery at all —
// calling refresh recursively from inside refresh would deadlock, and login
// has no token to attach in the first place.
const AUTH_NO_RETRY_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

// Single shared in-flight refresh promise. §2.3: two concurrent refresh
// calls with the same token race server-side and the loser's whole token
// family gets revoked — so the client must never fire more than one at a time.
let refreshInFlight = null;

function buildUrl(path, query) {
  const url = new URL(API_BASE_URL + path, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      // Array values append as repeated params (?key=a&key=b) — the backend
      // combines repeated `supportType` with OR (§ /search/cases charity+support filter).
      if (Array.isArray(value)) {
        value.forEach(v => {
          if (v === undefined || v === null || v === '') return;
          url.searchParams.append(key, v);
        });
        return;
      }
      url.searchParams.set(key, value);
    });
  }
  return url.pathname + url.search;
}

/**
 * For endpoints that return a raw body on success (e.g. `text/csv`) instead
 * of the standard `{success,data}` JSON envelope. On success, returns the
 * response text as-is; on failure, the body is still the standard JSON
 * envelope, so errors are parsed exactly like `parseEnvelope`.
 */
async function parseRawOrEnvelope(response) {
  if (response.ok) {
    return response.text();
  }
  return parseEnvelope(response);
}

async function parseEnvelope(response) {
  // A bare 401 with an empty body happens at the ASP.NET auth-challenge level
  // (no Bearer token at all) — it never reaches the app's envelope-writing
  // middleware, so there is no JSON to read. Treat it like UNAUTHORIZED.
  const rawText = await response.text();
  if (!rawText) {
    if (response.status === 401) {
      throw new ApiError('UNAUTHORIZED', undefined, undefined, 401);
    }
    throw new ApiError('INTERNAL_ERROR', 'استجابة فارغة من الخادم', undefined, response.status);
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    // A non-JSON body (e.g. a proxy/gateway error page) — treat as opaque failure.
    throw new ApiError('INTERNAL_ERROR', 'استجابة غير متوقعة من الخادم', undefined, response.status);
  }

  if (body && body.success === true) {
    return body.data;
  }

  const error = (body && body.error) || {};
  throw new ApiError(error.code || 'INTERNAL_ERROR', error.message, error.details, response.status);
}

/**
 * Performs one fetch and reads its whole body, all under a single timeout.
 * The timer covers headers AND body (a server can send headers and then stall),
 * so the body is read here and callers get a minimal response-like object
 * ({ ok, status, text() }) — which is all the parsers below use.
 * A caller-supplied `signal` still aborts the request (surfaced as AbortError);
 * only our own timeout becomes a RequestTimeoutError.
 */
async function doFetch(path, { method = 'GET', body, query, headers = {}, signal, timeoutMs = API_TIMEOUT_MS } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  const accessToken = TokenStore.getAccessToken();
  if (accessToken && !finalHeaders.Authorization) {
    finalHeaders.Authorization = `Bearer ${accessToken}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text: async () => text };
  } catch (cause) {
    if (timedOut) throw new RequestTimeoutError(cause);
    if (cause?.name === 'AbortError') throw cause;
    throw new NetworkError(cause);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Runs `fn` under a lock shared by every tab/window of this origin. The
 * in-memory `refreshInFlight` below only serializes callers inside ONE tab;
 * the tokens live in localStorage and are shared, so two tabs hitting a 401
 * together would each POST /auth/refresh with the same refresh token and the
 * server would treat the loser as token theft and revoke the whole chain.
 * Browsers without the Web Locks API fall back to per-tab serialization.
 */
function withCrossTabLock(fn) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (locks && typeof locks.request === 'function') {
    return locks.request('nahda-auth-refresh', fn);
  }
  return fn();
}

/**
 * @param {string|null} staleAccessToken - the access token the 401'd request
 *   was sent with. If storage holds a different one by the time we own the
 *   lock, another caller/tab already rotated the session and we must not
 *   spend the (now newer) refresh token again.
 */
async function refreshSession(staleAccessToken) {
  if (!refreshInFlight) {
    refreshInFlight = withCrossTabLock(async () => {
      const currentAccess = TokenStore.getAccessToken();
      if (staleAccessToken && currentAccess && currentAccess !== staleAccessToken) {
        return null;
      }

      const refreshToken = TokenStore.getRefreshToken();
      if (!refreshToken) throw new ApiError('TOKEN_INVALID', 'لا توجد جلسة نشطة');

      const response = await doFetch('/auth/refresh', {
        method: 'POST',
        body: { refreshToken }
      });
      const data = await parseEnvelope(response);
      // Rotation: the old refresh token is now dead — store the new pair
      // immediately, before anything else can read a stale token.
      TokenStore.setSession(data);
      return data;
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Network drops, timeouts, 5xx and rate limits say nothing about the session itself. */
function isTransientRefreshFailure(err) {
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiError) {
    return err.httpStatus >= 500 || err.httpStatus === 429;
  }
  return err?.name === 'AbortError';
}

function forceLogout(reason) {
  TokenStore.clearSession();
  EventBus.emit(EVENTS.SESSION_EXPIRED, { reason });
}

/**
 * @param {string} method
 * @param {string} path - e.g. '/cases/123' (no /api/v1 prefix — added here)
 * @param {Object} [opts]
 * @param {Object} [opts.body]
 * @param {Object} [opts.query]
 * @param {Object} [opts.headers]
 * @param {string} [opts.idempotencyKey] - required by the 8 workflow-transition routes
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.timeoutMs] - per-attempt timeout override (default API_TIMEOUT_MS)
 * @param {boolean} [opts.skipAuthRetry] - internal use (auth endpoints)
 * @param {boolean} [opts.raw] - success body is not the {success,data} envelope
 *   (e.g. a CSV export) — return response text as-is on 2xx, still parse the
 *   standard JSON envelope on failure.
 * @returns {Promise<*>} the unwrapped `data` payload (or raw text if `opts.raw`)
 */
export async function request(method, path, opts = {}) {
  const { body, query, signal, idempotencyKey, raw, timeoutMs } = opts;
  const headers = { ...(opts.headers || {}) };
  const parse = raw ? parseRawOrEnvelope : parseEnvelope;

  if (AUTH_NO_RETRY_PATHS.has(path)) {
    headers['X-Client-Type'] = 'web';
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  // Remembered so a late 401 (request sent before another caller/tab already
  // rotated the session) retries with the new token instead of refreshing again.
  const sentAccessToken = TokenStore.getAccessToken();
  const response = await doFetch(path, { method, body, query, headers, signal, timeoutMs });

  if (response.status === 401 && !AUTH_NO_RETRY_PATHS.has(path)) {
    try {
      await refreshSession(sentAccessToken);
    } catch (refreshErr) {
      // A flaky connection must not end the session — only a definitive
      // rejection from the server does.
      if (!isTransientRefreshFailure(refreshErr)) forceLogout('refresh_failed');
      throw refreshErr;
    }
    // Retry exactly once with the freshly-rotated access token.
    const retryHeaders = { ...headers };
    delete retryHeaders.Authorization; // doFetch re-reads the current token
    const retryResponse = await doFetch(path, { method, body, query, headers: retryHeaders, signal, timeoutMs });
    if (retryResponse.status === 401) {
      forceLogout('retry_still_401');
    }
    return parse(retryResponse);
  }

  return parse(response);
}

export const HttpClient = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, opts) => request('POST', path, opts),
  put: (path, opts) => request('PUT', path, opts),
  patch: (path, opts) => request('PATCH', path, opts),
  delete: (path, opts) => request('DELETE', path, opts)
};
