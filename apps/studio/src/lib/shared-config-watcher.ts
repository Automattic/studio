import fs from 'fs';
import { readAuthToken, getSharedConfigPath } from '@studio/common/lib/shared-config';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getMainWindow } from 'src/main-window';

let watcher: fs.FSWatcher | null = null;
let lastTokenJson: string | null = null;

export async function startSharedConfigWatcher() {
	if ( watcher ) {
		return;
	}

	const filePath = getSharedConfigPath();

	// Capture initial state
	lastTokenJson = JSON.stringify( await readAuthToken() );

	const fsEventHandler = async ( eventType: string ) => {
		await checkAuthChange();
		if ( eventType === 'rename' && watcher ) {
			watcher.close();
			watcher = fs.watch( filePath, fsEventHandler );
		}
	};

	watcher = fs.watch( filePath, fsEventHandler );
}

export function stopSharedConfigWatcher() {
	if ( watcher ) {
		watcher.close();
		watcher = null;
	}
}

async function checkAuthChange() {
	try {
		const token = await readAuthToken();
		const tokenJson = JSON.stringify( token );

		if ( tokenJson === lastTokenJson ) {
			return;
		}

		lastTokenJson = tokenJson;

		const mainWindow = await getMainWindow();
		if ( ! mainWindow || mainWindow.isDestroyed() ) {
			return;
		}

		if ( token ) {
			await sendIpcEventToRenderer( 'auth-updated', { token } );
		} else {
			// Token was removed — renderer needs to know to log out
			await sendIpcEventToRenderer( 'auth-updated', { token: null } );
		}
	} catch {
		// Ignore read errors (file may be mid-write)
	}
}
