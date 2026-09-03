import { __, sprintf } from '@wordpress/i18n';

/**
 * Label for the auto-updating WordPress version option, shared by the agentic UI
 * and the Classic renderer so translators only see one phrasing.
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
