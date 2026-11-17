/**
 * Keeps the latest verification result so the results page survives a reload.
 * (The image preview is a temporary blob URL and is not persisted.)
 */
let latest = null;
const KEY = 'prooflens:lastResult';

export function saveResult(entry) {
  latest = entry;
  try { sessionStorage.setItem(KEY, JSON.stringify({ result: entry.result, fileName: entry.fileName })); } catch { /* storage may be unavailable */ }
}

export function loadResult() {
  if (latest) return latest;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
