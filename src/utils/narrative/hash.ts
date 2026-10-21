/**
 * Small, dependency-free content hashing used for manuscript versions,
 * scene content identity, and protected-block identity.
 * FNV-1a 32-bit is not cryptographic; it is only used to detect change and
 * to give blocks a stable identity that survives repositioning.
 */

export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Normalizes line endings and trailing whitespace so cosmetic differences do not change identity. */
export function normalizeForHash(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

/** Stable manuscript version identifier: hash plus length (base 36). */
export function manuscriptVersionId(markdown: string): string {
  const norm = normalizeForHash(markdown);
  return `mv-${fnv1a(norm)}-${norm.length.toString(36)}`;
}

export function contentHash(text: string): string {
  return fnv1a(normalizeForHash(text));
}

/** Rough token estimate used only for budgeting model calls (about 4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
