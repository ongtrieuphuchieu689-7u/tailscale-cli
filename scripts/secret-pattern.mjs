export const TSKEX_PATTERN =
  /tskey-(?:client|auth|access|static|api)-[0-9A-Za-z_-]{20,}/g;

export const ALLOWED_PLACEHOLDERS = new Set([
  "tskey-client-k522tBdJ5D21CNTRL-xxxxxxxxxxxxxx",
  "tskey-client-k522tBdJ5D21CNTRL-abcdefghijklmnopqrstuvwxyz123456",
]);

export function findSecrets(text) {
  const found = [];
  for (const match of text.matchAll(TSKEX_PATTERN)) {
    const key = match[0];
    if (ALLOWED_PLACEHOLDERS.has(key)) continue;
    const payload = key.slice(13);
    const distinct = new Set(payload).size;
    if (payload.length >= 20 && distinct >= 12) found.push(key);
  }
  return found;
}
