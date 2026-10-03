/* --------------------------------------------------------------------------
   REFERENCE DATA CACHE (localStorage + server version check)
   Dropdown options, centers/villages and the charities roster change rarely
   and are identical for every signed-in user (confirmed with the backend,
   2026-09-30) — so they are kept in localStorage across reloads, tabs and
   logins, and shown instantly instead of re-fetching ~19 lists on every visit.

   Freshness: GET /reference-data/versions returns one fingerprint (ISO UTC
   timestamp) per list. Each cached entry remembers the fingerprint it was
   fetched under; an entry whose fingerprint no longer matches the server's
   is "stale" and gets re-fetched on its next read. Fingerprints are compared
   with !== only (backend contract — an empty list has a fixed sentinel, never
   null).

   Entry keys: `dropdown:<key>` (GET /dropdowns/<key>), `locations`
   (GET /locations), `charities` (GET /charities reference roster).

   If the versions endpoint fails (e.g. not deployed yet) the cache is simply
   trusted as-is — the app keeps working, it just can't detect changes until
   the check succeeds.
   -------------------------------------------------------------------------- */
import { HttpClient } from './http.js';
import { EventBus, EVENTS } from '../core/event-bus.js';

const CACHE_KEY = 'nahda_reference_cache';
// Bump when the shape of any cached payload changes — older caches are dropped.
const SCHEMA_VERSION = 1;
// Minimum gap between two version checks within one page load. Every new
// page load always checks once.
const REVALIDATE_INTERVAL_MS = 10 * 60 * 1000;

function emptyCache() {
  return { schema: SCHEMA_VERSION, entries: {} };
}

function readStoredCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (parsed && parsed.schema === SCHEMA_VERSION && parsed.entries && typeof parsed.entries === 'object') {
      return parsed;
    }
  } catch {
    // Unavailable storage or corrupt JSON — start empty.
  }
  return emptyCache();
}

function writeStoredCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Best-effort — a full/blocked localStorage just means no persistence.
  }
}

let cache = readStoredCache();

// Server fingerprints from the last successful check of this page load,
// flattened to entry keys. null = not known yet (cache is trusted as-is).
let latestVersions = null;
let lastCheckedAt = 0;
let revalidateInFlight = null;

// One pending fetch per entry key, so screens booting together share it.
const inFlight = new Map();
// Bumped by remove(): a fetch started before an invalidation must not write
// its (pre-mutation) result back into the cache.
const generations = new Map();

function flattenVersions(data) {
  const flat = {};
  Object.entries((data && data.dropdowns) || {}).forEach(([key, version]) => {
    flat[`dropdown:${key}`] = version;
  });
  if (data && data.locations !== undefined) flat.locations = data.locations;
  if (data && data.charities !== undefined) flat.charities = data.charities;
  return flat;
}

function isStale(entryKey) {
  const entry = cache.entries[entryKey];
  if (!entry || !latestVersions || !(entryKey in latestVersions)) return false;
  return entry.version !== latestVersions[entryKey];
}

function writeEntry(entryKey, data, version) {
  // Re-read first so another tab's newer entries aren't overwritten by this
  // tab's older in-memory copy.
  cache = readStoredCache();
  cache.entries[entryKey] = { version, data };
  writeStoredCache(cache);
}

export const ReferenceData = {
  /**
   * Returns the cached value for `entryKey` if present and not stale,
   * otherwise fetches it with `fetcher` and caches the result.
   * If the fetch fails but an older copy exists, the older copy is returned.
   * @template T
   * @param {string} entryKey
   * @param {() => Promise<T>} fetcher
   * @param {{forceRefresh?: boolean}} [opts]
   * @returns {Promise<T>}
   */
  load(entryKey, fetcher, { forceRefresh = false } = {}) {
    const entry = cache.entries[entryKey];
    if (!forceRefresh && entry && !isStale(entryKey)) {
      return Promise.resolve(entry.data);
    }

    const pending = inFlight.get(entryKey);
    if (pending && !forceRefresh) return pending;

    const generation = generations.get(entryKey) || 0;
    let version = null;

    // If a version check is running (always the case on a cold boot), let it
    // land first: data fetched without a fingerprint would be tagged null and
    // re-fetched in full on the next visit. Then tag with the fingerprint
    // known BEFORE the fetch: if the data changes mid-flight, the next check
    // sees a mismatch and re-fetches — the safe direction (never a newer tag
    // on older data).
    const promise = (revalidateInFlight || Promise.resolve())
      .then(() => {
        version = latestVersions ? latestVersions[entryKey] ?? null : null;
        return fetcher();
      })
      .then(data => {
        if ((generations.get(entryKey) || 0) === generation) {
          writeEntry(entryKey, data, version);
        }
        return data;
      })
      .catch(err => {
        const fallback = cache.entries[entryKey];
        if (fallback) return fallback.data;
        throw err;
      })
      .finally(() => {
        if (inFlight.get(entryKey) === promise) inFlight.delete(entryKey);
      });
    inFlight.set(entryKey, promise);
    return promise;
  },

  /** Synchronous read of whatever is cached (stale or not), or undefined. */
  peek(entryKey) {
    const entry = cache.entries[entryKey];
    return entry ? entry.data : undefined;
  },

  /** Drops one entry — used after a local write to that list. */
  remove(entryKey) {
    generations.set(entryKey, (generations.get(entryKey) || 0) + 1);
    inFlight.delete(entryKey);
    cache = readStoredCache();
    if (entryKey in cache.entries) {
      delete cache.entries[entryKey];
      writeStoredCache(cache);
    }
  },

  /** Drops every entry whose key starts with `prefix` (e.g. 'dropdown:'). */
  removeByPrefix(prefix) {
    cache = readStoredCache();
    const keys = new Set([...Object.keys(cache.entries), ...inFlight.keys()]);
    keys.forEach(key => {
      if (key.startsWith(prefix)) ReferenceData.remove(key);
    });
  },

  /**
   * Asks the server which lists changed (one small request). Stale cached
   * entries are announced via EVENTS.REFERENCE_DATA_CHANGED ({keys}) so the
   * screens showing them can re-read; the re-read itself fetches the new data.
   * Throttled to once per REVALIDATE_INTERVAL_MS unless `force`.
   * Never rejects.
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<string[]>} the stale entry keys
   */
  revalidate({ force = false } = {}) {
    if (revalidateInFlight) return revalidateInFlight;
    if (!force && lastCheckedAt && Date.now() - lastCheckedAt < REVALIDATE_INTERVAL_MS) {
      return Promise.resolve([]);
    }

    revalidateInFlight = HttpClient.get('/reference-data/versions')
      .then(data => {
        latestVersions = flattenVersions(data);
        cache = readStoredCache();
        const staleKeys = Object.keys(cache.entries).filter(isStale);
        if (staleKeys.length > 0) {
          EventBus.emit(EVENTS.REFERENCE_DATA_CHANGED, { keys: staleKeys });
        }
        return staleKeys;
      })
      .catch(err => {
        console.warn('[ReferenceData] version check failed — using cached data as-is:', err);
        return [];
      })
      .finally(() => {
        // Also on failure, so an endpoint that is down isn't hammered.
        lastCheckedAt = Date.now();
        revalidateInFlight = null;
      });
    return revalidateInFlight;
  }
};
