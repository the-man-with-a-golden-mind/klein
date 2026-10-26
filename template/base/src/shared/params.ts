/** URLPattern groups are not percent-decoded. Returns null for malformed escapes (→ 404). */
export function decodeParams(groups: Record<string, string | undefined>): Record<string, string> | null {
  const params: Record<string, string> = {};
  try {
    for (const [key, value] of Object.entries(groups)) {
      if (value !== undefined) params[key] = decodeURIComponent(value);
    }
  } catch {
    return null;
  }
  return params;
}
