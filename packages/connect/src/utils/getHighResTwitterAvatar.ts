export function getHighResTwitterAvatar(url?: string | null): string {
  if (!url) return "";
  // Replace '_normal' with '' to get higher resolution image
  return url.replace("_normal", "");
}
