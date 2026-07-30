import { captureException as coreCaptureException } from '@sentry/core';

/**
 * Report an exception to Sentry.
 *
 * Uses `@sentry/core` — the SDK-agnostic substrate `@sentry/electron` and
 * `@sentry/node` both build on — and routes to whichever client the host
 * initialized; a safe no-op if none did. Init stays each host's concern (one
 * client per process), so there's intentionally no shared init here.
 */
export function captureException( error: unknown ): void {
	coreCaptureException( error );
}
