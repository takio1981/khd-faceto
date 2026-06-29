export const environment = {
  production: false,
  // Relative (no leading slash) so it resolves against <base href> in
  // index.html regardless of what path prefix the app is served under —
  // see backend/src/index.ts for the matching /khd-faceto mount.
  apiBaseUrl: 'api',
};
