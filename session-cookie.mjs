// ChatGPT/NextAuth currently keeps each session-cookie value below the browser's
// single-cookie size ceiling and uses numbered chunks (.0, .1, ...).
// 3933 matches the value size observed in current ChatGPT cookies.
export const SESSION_CHUNK_VALUE_SIZE = 3933;

export function splitSessionValue(value, chunkSize = SESSION_CHUNK_VALUE_SIZE) {
  if (typeof value !== "string" || !value) {
    throw new Error("Session Token 为空。");
  }

  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("无效的 Session 分片大小。");
  }

  const chunks = [];
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    chunks.push(value.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function buildSessionCookieEntries(baseName, value, chunkSize = SESSION_CHUNK_VALUE_SIZE) {
  const chunks = splitSessionValue(value, chunkSize);

  if (chunks.length === 1) {
    return [{ name: baseName, value: chunks[0] }];
  }

  return chunks.map((chunk, index) => ({
    name: `${baseName}.${index}`,
    value: chunk
  }));
}

export function belongsToSessionCookieFamily(cookieName, baseNames) {
  return baseNames.some(
    (baseName) => cookieName === baseName || cookieName.startsWith(`${baseName}.`)
  );
}
