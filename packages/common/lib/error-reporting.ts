let report: ( ( error: unknown ) => void ) | undefined;

/**
 * Set by a host that reports how the CLI commands it starts fail (the Desktop app, as
 * `CliCommandError`s), so the CLI doesn't report those failures a second time.
 */
export const HOST_REPORTS_CLI_ERRORS_ENV = 'STUDIO_HOST_REPORTS_CLI_ERRORS';

/**
 * Each host passes its Sentry SDK's `captureException` once it has set Sentry up. Importing a
 * Sentry package here instead would only reach the host's client while both use the same version
 * of `@sentry/core`, which keeps its client in a global per version.
 */
export function setErrorReporter( captureException: ( error: unknown ) => void ): void {
	report = captureException;
}

/** Reports an exception to Sentry, through the host's SDK; a no-op in a host that has none. */
export function captureException( error: unknown ): void {
	report?.( error );
}

// The account name in a macOS, Linux or Windows home path, with `\` or `/` separators, escaped or not.
const HOME_PATH_PATTERN =
	/(?<![\w.])([A-Z]:)?(\\{1,2}|\/)(Users|home)\2[^\\/"'`\n]+(?=[\\/"'`\n]|$)/gi;

export function redactHomePaths( text: string ): string {
	return text.replace( HOME_PATH_PATTERN, '$1$2$3$2[REDACTED]' );
}

/**
 * Errors can shape their own report:
 * - `expected: true`: not a bug, so it isn't sent (a CLI command its host stopped, say);
 * - `fingerprint`: what groups them into one issue, when the message varies between events.
 */
type ReportedError = {
	expected?: unknown;
	fingerprint?: unknown;
	domain?: unknown;
	code?: unknown;
};

function getFingerprint( error: ReportedError ): string[] | undefined {
	if ( Array.isArray( error.fingerprint ) ) {
		return error.fingerprint;
	}
	// Electron passes on macOS errors as their `NSError` domain and code; the message is localized.
	if ( typeof error.domain === 'string' && typeof error.code === 'number' ) {
		return [ '{{ type }}', error.domain, String( error.code ) ];
	}
	return undefined;
}

/**
 * Every host's Sentry `beforeSend`, so call sites can report whatever they catch: drops expected
 * errors, groups errors whose message varies, and redacts account names from paths.
 */
export function prepareErrorEvent< Event extends { fingerprint?: string[] } >(
	event: Event,
	hint: { originalException?: unknown }
): Event | null {
	const error = hint.originalException;
	if ( typeof error === 'object' && error !== null ) {
		const reported = error as ReportedError;
		if ( reported.expected === true ) {
			return null;
		}
		event.fingerprint = getFingerprint( reported ) ?? event.fingerprint;
	}
	return JSON.parse( redactHomePaths( JSON.stringify( event ) ) );
}
