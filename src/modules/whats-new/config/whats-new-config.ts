/**
 * Configuration for the What's New feature
 *
 * This file contains settings that control when the What's New modal appears.
 * Add version numbers to the forceWhatsNewVersions array to make the modal
 * appear for those specific versions, even if they're just patch updates.
 */

/**
 * List of versions that should always show the What's New modal,
 * regardless of the normal version comparison logic.
 */
export const forceWhatsNewVersions: string[] = [];

/**
 * Determines if the What's New modal should be forced for a specific version
 *
 * @param version The current application version
 * @returns True if the modal should be forced for this version
 */
export const shouldForceWhatsNew = ( version: string ): boolean => {
	return forceWhatsNewVersions.includes( version );
};
