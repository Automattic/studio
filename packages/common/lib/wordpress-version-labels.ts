import { __, sprintf } from '@wordpress/i18n';

/**
 * Label for the auto-updating WordPress version option, shared by the agentic UI
 * and the Classic renderer so translators only see one phrasing.
 *
 * @param installedVersion Version the site runs right now. Pass it only when
 *                         auto-update is the selected mode — the brackets are a
 *                         readout of the current state, so on a pinned site they
 *                         would name a version auto-update is not keeping you on.
 *                         A value that is not a concrete version number (`-`,
 *                         `latest`) falls back to the bare label.
 */
export function getAutoUpdateVersionLabel( installedVersion?: string ): string {
	if ( ! installedVersion || ! /^\d/.test( installedVersion ) ) {
		/* translators: WordPress version dropdown option. Names the auto-update mode, not a version. */
		return __( 'Auto-update' );
	}
	return sprintf(
		/* translators: %s: WordPress version the site runs now, e.g. 6.9.7 */
		__( 'Auto-update (%s)' ),
		installedVersion
	);
}
