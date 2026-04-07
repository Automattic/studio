/**
 * Checks whether the WebAssembly JavaScript Promise Integration (JSPI) API
 * is available in the current runtime.
 *
 * JSPI is required for Redis and memcached PHP extensions in WordPress
 * Playground. It's currently gated behind Node's `--experimental-wasm-jspi`
 * flag. Once it ships unflagged, this helper will return `true`
 * automatically — no code changes needed.
 */
export const IS_JSPI_AVAILABLE = 'Suspending' in WebAssembly;
