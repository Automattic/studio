/**
 * Checks if a version string represents a development release
 * Handles both old format (-dev.HASH) and new format (-devN)
 */
export function isDevRelease( version: string ): boolean {
	return /-dev\..*|-dev\d+/.test( version );
}
