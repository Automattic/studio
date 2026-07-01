//
// ensureUrlScheme
// ===============
// Adds `https://` to a scheme-less URL so `new URL()` won't throw on bare-host
// input like `www.example.com`. Idempotent for already-schemed URLs.
//
// The codebase repeats `url.includes('://') ? url : `https://${url}`` in many
// adapters; this is the shared form. Use it before any `new URL(userUrl)`.
//
export function ensureUrlScheme(url: string): string {
  return url.includes('://') ? url : `https://${url}`;
}
