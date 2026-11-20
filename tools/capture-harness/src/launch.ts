import { updateProfileConfig } from './config.ts';
import { launchBrowser } from './drivers/browser.ts';
import { launchElectron } from './drivers/electron.ts';
import type { DriverName, LaunchOptions, Studio } from './drivers/types.ts';
import type { Look } from './schema.ts';

export type { Studio } from './drivers/types.ts';

// `ORIENTATION_GUIDE_VERSION` and `WHATS_NEW_VERSION` in the Studio source,
// apps/ui/src/features/onboarding/onboarding-guide/ (2 and 1 as of 2.0).
const ORIENTATION_GUIDE_VERSION = 2;
const WHATS_NEW_VERSION = 1;

/**
 * The preferences for a launch. `firstRun` starts on the Welcome dialog;
 * otherwise onboarding and both guides are marked done. The appearance comes
 * from the look, so captures don't follow the OS.
 */
function buildPreferences( firstRun: boolean, appearance: Look[ 'appearance' ] ) {
	return {
		locale: 'en',
		...appearance,
		...( firstRun
			? {}
			: {
					onboardingCompleted: true,
					onboardingHints: {
						tourDismissedVersion: ORIENTATION_GUIDE_VERSION,
						whatsNewSeenVersion: WHATS_NEW_VERSION,
						annotateHintDismissed: true,
					},
			  } ),
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
		siteSettings = {},
		placements = {},
		authToken = null,
		avatar,
		account,
	}: LaunchOptions
): Promise< Studio > {
	await updateProfileConfig( profile, ( config ) => {
		config.preferences = buildPreferences( firstRun, look.appearance );
		for ( const site of config.sites ?? [] ) {
			Object.assign( site, siteSettings[ String( site.id ) ] );
		}
		for ( const [ id, placement ] of Object.entries( placements ) ) {
			config.sessions = { ...config.sessions, [ id ]: { ...config.sessions?.[ id ], placement } };
		}
		// Scripts sharing a profile can differ in whether they are signed in.
		const { wpcom: _previous, ...configs } = config.providers?.configs ?? {};
		config.providers = {
			...config.providers,
			configs: authToken
				? {
						...configs,
						wpcom: {
							token: authToken.accessToken,
							expiresAt: authToken.expirationTime,
							user: {
								id: authToken.id,
								email: authToken.email,
								displayName: authToken.displayName,
							},
						},
				  }
				: configs,
		};
	} );
	const launch = driver === 'browser' ? launchBrowser : launchElectron;
	return launch( { profile, look, firstRun, authToken, avatar, account } );
}
