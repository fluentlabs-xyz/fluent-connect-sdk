/**
 * Stand-ins for the two avatar sources the real widget resolves: an X profile
 * picture from Privy, and the host's `config.avatar.defaultLogoUrl`. Data URIs so
 * the harness needs no network and no files on disk.
 */
export const MOCK_X_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1d9bf0"/><text x="16" y="22" font-family="sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">X</text></svg>`,
  );
export const SAMPLE_CUSTOM_LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#ff5c28"/><path d="M9 23V9h5l3 7 3-7h5v14h-4v-8l-3 6h-2l-3-6v8z" fill="#fff"/></svg>`,
  );
