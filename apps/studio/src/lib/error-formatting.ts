import { getErrorMessage } from '@studio/common/lib/error-formatting';

const ANSI_ESCAPE_SEQUENCE = new RegExp(
	`${ String.fromCharCode( 27 ) }\\[[0-?]*[ -/]*[@-~]`,
	'g'
);

function stripTerminalControlCharacters( value: string ): string {
	return value.replace( ANSI_ESCAPE_SEQUENCE, '' );
}

/**
 * Simplifies an error for user-friendly display by removing stack traces and technical details.
 * This helps present cleaner, more actionable error messages in the UI.
 *
 * @param error - The error to simplify. Can be an Error object or unknown.
 * @returns A simplified error suitable for display to users.
 */
export function simplifyErrorForDisplay(
	error: unknown,
	fallbackMessage = 'An unknown error occurred.'
): Error {
	const message = getErrorMessage( error ) ?? fallbackMessage;
	const firstLine = stripTerminalControlCharacters( message ).split( '\n' )[ 0 ].trim();
	return new Error( firstLine || fallbackMessage );
}

/**
 * Like `simplifyErrorForDisplay`, but also truncates to the first sentence.
 * Useful when the first line is a long, detailed error message and the dialog
 * should stay concise (e.g. blueprint errors). Full details are available via logs.
 */
export function simplifyErrorToFirstSentence( error: unknown ): Error {
	const simplified = simplifyErrorForDisplay( error );
	const firstSentence = simplified.message.match( /^.+?\.(?=\s|$)/ );
	return firstSentence ? new Error( firstSentence[ 0 ] ) : simplified;
}

/**
 * Extract a user-facing error message from process manager logs. The child process often logs
 * detailed error information to stdout (via playground-cli) before exiting. This scans log
 * lines for "Error:" prefixed entries which typically contain the root cause.
 */
export function extractErrorFromProcessManagerLogs( logs: {
	stdout?: string[];
	stderr?: string[];
} ): string | undefined {
	const lines = [ ...( logs.stdout ?? [] ), ...( logs.stderr ?? [] ) ];

	for ( let i = lines.length - 1; i >= 0; i-- ) {
		// Log lines are timestamped: "2026-05-15T08:38:04.859Z Error: ..."
		// Strip the timestamp prefix to get the raw message.
		const line = lines[ i ].replace( /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '' ).trim();
		if ( line.startsWith( 'Error:' ) || line.startsWith( 'Error when' ) ) {
			return line;
		}
	}

	return undefined;
}
