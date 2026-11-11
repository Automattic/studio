export function errorMessageContains( error: unknown, substring: string ): boolean {
	if ( error instanceof Error ) {
		return error.message.includes( substring );
	}
	return false;
}
