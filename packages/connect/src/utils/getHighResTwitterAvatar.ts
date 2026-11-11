export function getHighResTwitterAvatar(url?: string | null): string {
  if (!url) return "";
  // X serves an avatar's small variant under a `_normal` suffix and the original without it.
  return url.replace("_normal", "");
}
