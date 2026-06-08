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
