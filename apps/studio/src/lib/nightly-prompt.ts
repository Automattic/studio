import { app, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { isDevRelease } from 'src/lib/version-utils';
import { getMainWindow } from 'src/main-window';
import { loadUserData, updateAppdata } from 'src/storage/user-data';
import { switchToNightlyAndUpdate } from 'src/updates';

let isPromptOpen = false;

async function isAutomattician(): Promise< boolean > {
	try {
		const token = await readAuthToken();
		if ( ! token ) {
			return false;
		}

		const res = await fetch( 'https://public-api.wordpress.com/rest/v1.2/read/teams', {
			headers: { Authorization: `Bearer ${ token.accessToken }` },
			signal: AbortSignal.timeout( 5000 ),
		} );

		if ( ! res.ok ) {
			return false;
		}

		const data = ( await res.json() ) as { teams?: { slug: string }[] };
		return data.teams?.some( ( team ) => team.slug === 'a8c' ) ?? false;
	} catch {
		return false;
	}
}

/**
 * Shows a one-time dialog prompting Automatticians on stable builds to switch to nightly builds.
 * - Skipped if already on a dev/nightly build.
 * - Skipped if the user previously chose "Don't ask again" or already switched.
 * - Skipped if the user is not authenticated or not an Automattician.
 */
export async function maybePromptNightlySwitch(): Promise< void > {
	if ( process.env.E2E || ! app.isPackaged ) {
		return;
	}

	// Already on a nightly build — nothing to prompt.
	if ( isDevRelease( app.getVersion() ) ) {
		return;
	}

	const userData = await loadUserData();
	const result = userData.nightlyPromptResult;

	if ( result?.dontAskAgain ) {
		return;
	}

	if ( isPromptOpen ) {
		return;
	}

	const automattician = await isAutomattician();
	if ( ! automattician ) {
		return;
	}

	const SWITCH = __( 'Switch to nightly builds' );
	const NOT_NOW = __( 'Not now' );
	const buttons = [ SWITCH, NOT_NOW ];

	isPromptOpen = true;
	const mainWindow = await getMainWindow();
	const { response, checkboxChecked } = await dialog.showMessageBox( mainWindow, {
		type: 'question',
		buttons,
		title: __( 'Try nightly builds?' ),
		message: __(
			'As an Automattician, you can run the latest trunk build of Studio and get updates daily.'
		),
		detail: __(
			'Nightly builds let you catch issues earlier and try new features before they ship. You can always reinstall the stable version if needed.'
		),
		checkboxLabel: __( "Don't ask me again" ),
		defaultId: buttons.indexOf( SWITCH ),
		cancelId: buttons.indexOf( NOT_NOW ),
	} );

	isPromptOpen = false;

	switch ( response ) {
		case buttons.indexOf( SWITCH ):
			// Don't suppress future prompts on 'yes' — if the update fails or the user
			// hasn't installed the nightly yet, we want to offer it again on next launch.
			// The isDevRelease() guard at the top naturally suppresses once they're on nightly.
			if ( checkboxChecked ) {
				await updateAppdata( {
					nightlyPromptResult: { response: 'yes', dontAskAgain: true },
				} );
			}
			switchToNightlyAndUpdate();
			break;

		case buttons.indexOf( NOT_NOW ):
			await updateAppdata( {
				nightlyPromptResult: { response: 'no', dontAskAgain: checkboxChecked },
			} );
			break;
	}
}

/**
 * Starts a recurring check that runs maybePromptNightlySwitch once per hour.
 * This catches users who sign in after the initial app launch.
 *
 * @returns A cleanup function that clears the interval.
 */
export function startNightlyPromptPoller(): () => void {
	const ONE_HOUR_MS = 60 * 60 * 1000;
	const interval = setInterval( () => {
		void maybePromptNightlySwitch().catch( Sentry.captureException );
	}, ONE_HOUR_MS );

	return () => clearInterval( interval );
}
