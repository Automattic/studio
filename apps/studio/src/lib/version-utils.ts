/**
 * Checks if a version string represents a development release
 * Handles both old format (-dev.HASH) and new format (-devN)
 * @param version The version string to check
 * @returns boolean indicating if this is a dev release
 */
export function isDevRelease( version: string ): boolean {
	return /-dev\..*|-dev\d+/.test( version );
}
