export function getErrorMessage( error: unknown ): string | undefined {
	if ( error instanceof Error ) {
		return error.message.trim() || undefined;
	}

	if ( typeof error === 'string' ) {
		return error.trim() || undefined;
	}

	if (
		error !== null &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message.trim() || undefined;
	}

	return undefined;
}

// Electron wraps errors crossing the IPC boundary as "Error invoking remote
// method '<name>': <Type>: <message>". Strip that envelope so the original
// message can be shown to the user.
export function stripIpcErrorPrefix( message: string ): string {
	return message.replace( /^Error invoking remote method '[^']+': (?:\w+Error: |Error: )?/, '' );
}

// A `CliCommandError` message puts the CLI's own error first, then diagnostics
// for the logs: "[Last error message] …\n  [Base message] …\n  [stderr] …".
// Keep only the CLI's error, or nothing when it reported none.
export function stripCliErrorEnvelope( message: string ): string {
	const lastError = /^\[Last error message\] ([\s\S]*?)(?:\n {2}\[|$)/.exec( message );
	if ( lastError ) {
		return lastError[ 1 ];
	}
	return message.startsWith( '[Base message] ' ) ? '' : message;
}
