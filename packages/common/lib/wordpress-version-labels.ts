import { __, sprintf } from '@wordpress/i18n';

/**
 * Copy for the WordPress version controls, shared by the agentic UI and the
 * Classic renderer so translators only see one phrasing. Each one is a function
 * so the Classic renderer, which swaps locale data live, re-reads it on render.
 */

/**
 * Label for the auto-updating WordPress version option. Only the plain dropdown
 * renders it — the fallback for a missing version list. Everywhere else the mode
 * is one of the update-mode radios below.
 *
 * @param version Version the site runs under auto-update: the installed one on
 *                an existing site, the one about to be installed on the create
 *                form. Omit it on a pinned site — the brackets are a readout of
 *                the current state, so they would name a version auto-update is
 *                not keeping you on. A value that is not a concrete version
 *                number (`-`, `latest`) falls back to the bare label.
 */
export function getAutoUpdateVersionLabel( version?: string ): string {
	if ( ! version || ! /^\d/.test( version ) ) {
		/* translators: WordPress version dropdown option. Names the auto-update mode, not a version. */
		return __( 'Auto-update' );
	}
	return sprintf(
		/* translators: %s: WordPress version the site runs under auto-update, e.g. 6.9.7 */
		__( 'Auto-update (%s)' ),
		version
	);
}

export function getAutomaticUpdatesLabel(): string {
	return __( 'Automatic updates' );
}

export function getSelectAVersionLabel(): string {
	return __( 'Select a version' );
}

/**
 * @param version Version the site runs under auto-update. Pass it only while
 *                auto-update is the selected mode: on a pinned site it would
 *                read as if auto-update were keeping the site on that version
 *                (STU-2348). A value that is not a concrete version number
 *                (`-`, `latest`) falls back to the bare description.
 */
export function getAutomaticUpdatesDescription( version?: string ): string {
	if ( ! version || ! /^\d/.test( version ) ) {
		return __( 'WordPress installs updates on its own schedule.' );
	}
	return sprintf(
		/* translators: %s: WordPress version the site runs under auto-update, e.g. 6.9.7 */
		__( 'WordPress installs updates on its own schedule. Currently using version %s.' ),
		version
	);
}
