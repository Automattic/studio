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

/**
 * A host's Sentry `beforeSend`: drops errors that set `expected`, like a CLI command its host
 * stopped, so call sites can report everything they catch.
 */
export function dropExpectedErrors< Event >(
	event: Event,
	{ originalException }: { originalException?: unknown }
): Event | null {
	const expected =
		typeof originalException === 'object' &&
		originalException !== null &&
		'expected' in originalException &&
		originalException.expected === true;
	return expected ? null : event;
}
