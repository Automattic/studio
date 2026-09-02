import { __, sprintf } from '@wordpress/i18n';

/**
 * Copy for the WordPress version controls, shared by the agentic UI and the
 * Classic renderer so translators only see one phrasing. Each one is a function
 * so the Classic renderer, which swaps locale data live, re-reads it on render.
 */

/**
 * Names the auto-update mode in the plain version dropdown. Only the fallback
 * for a missing version list renders it — everywhere else the mode lives behind
 * the "Automatic updates" toggle.
 */
export function getAutoUpdateVersionLabel(): string {
	/* translators: WordPress version dropdown option. Names the auto-update mode, not a version. */
	return __( 'Auto-update' );
}

export function getAutoUpdatesToggleLabel(): string {
	return __( 'Automatic updates' );
}

export function getAutoUpdatesHelpText( automaticUpdates: boolean ): string {
	return automaticUpdates
		? __(
				'WordPress updates this site on its own schedule. New releases may not be installed immediately.'
		  )
		: __( 'This site stays on the version you choose.' );
}

export function getInstalledVersionLabel( installedVersion: string ): string {
	return sprintf(
		/* translators: %s: WordPress version the site runs now, e.g. 6.9.7 */
		__( 'Installed version: %s' ),
		installedVersion
	);
}
