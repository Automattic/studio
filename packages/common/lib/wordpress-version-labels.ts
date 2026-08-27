import { __, sprintf } from '@wordpress/i18n';

/**
 * Label for the auto-updating WordPress version option, shared by the agentic
 * UI and the Classic renderer so translators only see one phrasing.
 *
 * "latest" is a mode, not a version: Studio enables WordPress core auto-updates
 * for those sites and pins every other choice. The old "latest" label read as a
 * promise that the site already runs the newest release, so wp-admin's update
 * notice looked like a contradiction (STU-2348).
 *
 * @param installedVersion The version the site runs right now, when it is known.
 *                         Omit it on the create-site form, and for sites that
 *                         are pinned — naming a version next to "Auto-update"
 *                         would read as if auto-updates were already on.
 *                         Anything that isn't a concrete version number (`-`,
 *                         `latest`) falls back to the bare label, since
 *                         "Auto-update (latest)" would say nothing.
 */
export function getAutoUpdateVersionLabel( installedVersion?: string ): string {
	if ( ! installedVersion || ! /^\d/.test( installedVersion ) ) {
		return __( 'Auto-update' );
	}
	return sprintf(
		/* translators: %s: WordPress version the site runs now, e.g. 6.9.7 */
		__( 'Auto-update (%s)' ),
		installedVersion
	);
}
