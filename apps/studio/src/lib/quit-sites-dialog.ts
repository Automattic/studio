import { dialog } from 'electron';
import { __, _n, sprintf } from '@wordpress/i18n';
import { type QuitSitesBehavior } from 'src/storage/user-data';

export interface QuitSitesDialogChoice {
	behavior: QuitSitesBehavior;
	remember: boolean;
}

// Site names are user-typed and unbounded; past this length the name-based
// sentence wraps into a wall of text, so we fall back to a count instead.
const MAX_LISTED_NAME_LENGTH = 30;

function getDetailText( runningSiteNames: string[] ): string {
	const canListNames =
		runningSiteNames.length <= 2 &&
		runningSiteNames.every( ( name ) => name.length <= MAX_LISTED_NAME_LENGTH );

	if ( canListNames && runningSiteNames.length === 1 ) {
		return sprintf(
			/* translators: %s: site name */
			__( '%s can stay available in the background after Studio quits.' ),
			runningSiteNames[ 0 ]
		);
	}
	if ( canListNames && runningSiteNames.length === 2 ) {
		return sprintf(
			/* translators: %1$s, %2$s: site names */
			__( '%1$s and %2$s can stay available in the background after Studio quits.' ),
			runningSiteNames[ 0 ],
			runningSiteNames[ 1 ]
		);
	}
	return sprintf(
		/* translators: %d: number of running sites */
		_n(
			'Your running site can stay available in the background after Studio quits.',
			'Your %d running sites can stay available in the background after Studio quits.',
			runningSiteNames.length
		),
		runningSiteNames.length
	);
}

/**
 * Ask the user what to do with running sites when Studio quits: keep them
 * running in the background, or stop them. Returns null when cancelled.
 * Stopping maps to 'stop-and-auto-start' — sites come back on next launch.
 * The plain 'stop' behavior (stay stopped) is only configurable in Settings.
 */
export async function showQuitSitesDialog(
	runningSiteNames: string[]
): Promise< QuitSitesDialogChoice | null > {
	const KEEP_BUTTON_INDEX = 0;
	const CANCEL_BUTTON_INDEX = 2;

	const { response, checkboxChecked } = await dialog.showMessageBox( {
		type: 'question',
		message: _n( 'Keep your site running?', 'Keep your sites running?', runningSiteNames.length ),
		detail: getDetailText( runningSiteNames ),
		buttons: [
			__( 'Keep running' ),
			_n( 'Stop site', 'Stop sites', runningSiteNames.length ),
			__( 'Cancel' ),
		],
		checkboxLabel: __( 'Remember my choice' ),
		cancelId: CANCEL_BUTTON_INDEX,
		defaultId: KEEP_BUTTON_INDEX,
	} );

	if ( response === CANCEL_BUTTON_INDEX ) {
		return null;
	}

	return {
		behavior: response === KEEP_BUTTON_INDEX ? 'leave-running' : 'stop-and-auto-start',
		remember: checkboxChecked,
	};
}
