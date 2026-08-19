/**
 * Supabase Storage uses HTTP 400 for the `Object not found` error on some
 * object endpoints. Cleanup is intentionally idempotent, so that response is
 * equivalent to a 404 for a delete that was already completed elsewhere.
 * Other 400 responses (invalid path, auth, RLS, etc.) must remain visible.
 */
const MISSING_OBJECT_MESSAGE = /(?:object|resource)\s+(?:was\s+)?not\s+found|no\s+such\s+key|nosuchkey/i;
const MISSING_OBJECT_CODE = /["'](?:code|error)["']\s*:\s*["'](?:not[_ -]?found|nosuchkey)["']/i;

export function isMissingStorageObjectResponse(status: number, body = '') {
  if (status === 404) return true;
  if (status !== 400) return false;
  return MISSING_OBJECT_MESSAGE.test(body) || MISSING_OBJECT_CODE.test(body);
}
