import * as Sentry from '@sentry/electron/main';
import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import { isPortFree } from '@studio/common/lib/port-finder';
import { readRemoteServerInfo } from '@studio/common/lib/remote-access';
import { createPhoneAccess } from 'src/modules/phone-access/lib/phone-access';
import { isProcessAlive, startRemote } from 'src/modules/phone-access/lib/remote-process';

// The app's one remote mode for the phone. Its switch, port and connection are
// kept in the config's `desktop` section.
export const phoneAccess = createPhoneAccess( {
	readServer: readRemoteServerInfo,
	isAlive: isProcessAlive,
	isPortFree,
	startRemote,
	loadSettings: async () => {
		const { desktop } = await readConfig();
		return {
			enabled: desktop.phoneAccess === true,
			port: desktop.phoneAccessPort,
			connection: desktop.phoneConnection ?? 'auto',
			url: desktop.phoneAccessUrl,
		};
	},
	saveSettings: async ( { enabled, port, connection, url } ) => {
		try {
			await updateConfig( ( { desktop } ) => {
				if ( enabled !== undefined ) {
					desktop.phoneAccess = enabled;
				}
				if ( port !== undefined ) {
					desktop.phoneAccessPort = port;
				}
				if ( connection !== undefined ) {
					desktop.phoneConnection = connection;
				}
				if ( url !== undefined ) {
					desktop.phoneAccessUrl = url;
				}
			} );
		} catch ( error ) {
			// Turning off must not look done while the config still has the switch
			// on: remote mode would start again at the next launch.
			Sentry.captureException( error );
			throw error;
		}
	},
	sleep: ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) ),
} );
