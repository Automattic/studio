/**
 * Simplifies an error for user-friendly display by removing stack traces and technical details.
 * This helps present cleaner, more actionable error messages in the UI.
 *
 * @param error - The error to simplify. Can be an Error object or unknown.
 * @returns A simplified error suitable for display to users, or the original error if it's not an Error object.
 */
export function simplifyErrorForDisplay( error: unknown ): unknown {
	if ( error instanceof Error && error.message ) {
		const firstLine = error.message.split( '\n' )[ 0 ].trim();
		return new Error( firstLine );
	}
	return error;
}
