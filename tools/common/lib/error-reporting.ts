import { captureException as coreCaptureException } from '@sentry/core';

/**
 * Report an exception to Sentry from shared code.
 *
 * This deliberately uses `@sentry/core` — the SDK-agnostic substrate that both
 * `@sentry/electron` (desktop) and `@sentry/node` (CLI / `studio ui`) build on —
 * so the *reporting* code is identical for every host. It routes to whichever
 * client the host initialized; if none did, it's a safe no-op. Initialization
 * stays each host's own concern — there's intentionally no shared init here
 * (one client per process, environment-specific SDK): the desktop inits
 * `@sentry/electron`; the CLI would init `@sentry/node` itself.
 */
export function captureException( error: unknown ): void {
	coreCaptureException( error );
}
