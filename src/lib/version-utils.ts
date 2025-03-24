/**
 * Checks if a version string represents a development release
 * Handles both old format (-dev.HASH) and new format (-devN)
 * @param version The version string to check
 * @returns boolean indicating if this is a dev release
 */
export function isDevRelease( version: string ): boolean {
	return /-dev\..*|-dev\d+/.test( version );
}

/**
 * Checks if a version string represents a WordPress development version
 * Matches patterns like "6.8-beta2-59979"
 * @param version The version string to check
 * @returns boolean indicating if this is a WordPress development version
 */
export function isWordPressDevVersion( version: string ): boolean {
	return /^\d+\.\d+-[a-zA-Z0-9]+-\d+$/.test( version );
}
