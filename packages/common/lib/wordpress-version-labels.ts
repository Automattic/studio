import { __, sprintf } from '@wordpress/i18n';

/**
 * Copy for the WordPress version controls, shared by the agentic UI and the
 * Classic renderer so translators only see one phrasing. Each one is a function
 * so the Classic renderer, which swaps locale data live, re-reads it on render.
 */

/**
 * Names the auto-update mode in the plain version dropdown. Only the fallback
 * for a missing version list renders it — everywhere else the mode is one of
 * the update-mode radios.
 */
export function getAutoUpdateVersionLabel(): string {
	/* translators: WordPress version dropdown option. Names the auto-update mode, not a version. */
	return __( 'Auto-update' );
}

export function getAutomaticUpdatesLabel(): string {
	return __( 'Automatic updates' );
}

export function getSelectAVersionLabel(): string {
	return __( 'Select a version' );
}

/**
 * @param installedVersion Version the site runs right now. Pass it only while
 *                         auto-update is the selected mode: on a pinned site it
 *                         would read as if auto-update were keeping the site on
 *                         that version (STU-2348).
 */
export function getAutomaticUpdatesDescription( installedVersion?: string ): string {
	if ( ! installedVersion ) {
		return __( 'WordPress installs updates on its own schedule.' );
	}
	return sprintf(
		/* translators: %s: WordPress version the site runs now, e.g. 6.9.7 */
		__( 'WordPress installs updates on its own schedule. Currently using version %s.' ),
		installedVersion
	);
}
