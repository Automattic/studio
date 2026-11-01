import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './drivers/browser.ts';
import { launchElectron } from './drivers/electron.ts';
import { readJson } from './paths.ts';
import type { DriverName, LaunchOptions, Studio } from './drivers/types.ts';
import type { Look } from './schema.ts';

export type { Studio } from './drivers/types.ts';

// `ORIENTATION_GUIDE_VERSION` and `WHATS_NEW_VERSION` in the Studio source,
// apps/ui/src/features/onboarding/onboarding-guide/ (2 and 1 as of 2.0).
const ORIENTATION_GUIDE_VERSION = 2;
const WHATS_NEW_VERSION = 1;

/**
 * Initial `app.json` (Studio's own state, which both front ends read) for a
 * launch. `firstRun` starts on the Welcome dialog; otherwise onboarding and
 * both guides are marked done. The appearance comes from the look, so
 * captures don't follow the OS.
 */
function buildAppConfig( {
	firstRun,
	appData,
	appearance,
}: {
	firstRun: boolean;
	appData: Record< string, unknown >;
	appearance: Look[ 'appearance' ];
} ) {
	return {
		version: 1,
		...appearance,
		...( firstRun
			? {}
			: {
					onboardingCompleted: true,
					onboardingHints: {
						tourDismissedVersion: ORIENTATION_GUIDE_VERSION,
						whatsNewSeenVersion: WHATS_NEW_VERSION,
					},
			  } ),
		...appData,
	};
}

/**
 * Launches Studio against a profile from `createProfile()`: the Desktop app
 * (`electron`) or the browser app served by `studio ui` (`browser`), in a
 * window of the look's size and scale. A signed-in launch is always guarded,
 * whichever front end it is. `account` answers for the signed-in account
 * before anything is shown.
 */
export async function launchStudio(
	driver: DriverName,
	{
		profile,
		look,
		firstRun = false,
		appData = {},
		authToken = null,
		avatar,
		account,
	}: LaunchOptions
): Promise< Studio > {
	await writeFile(
		path.join( profile.dirs.sharedConfig, 'app.json' ),
		JSON.stringify( buildAppConfig( { firstRun, appData, appearance: look.appearance } ), null, 2 )
	);
	// Scripts sharing a profile can differ in whether they are signed in.
	const sharedPath = path.join( profile.dirs.sharedConfig, 'shared.json' );
	const { authToken: _previous, ...shared } =
		await readJson< Record< string, unknown > >( sharedPath );
	await writeFile(
		sharedPath,
		JSON.stringify( authToken ? { ...shared, authToken } : shared, null, 2 )
	);
	const launch = driver === 'browser' ? launchBrowser : launchElectron;
	return launch( { profile, look, firstRun, appData, authToken, avatar, account } );
}
