import fs from 'fs';
import { getMainWindow } from 'src/main-window';
import { getUserDataFilePath } from 'src/storage/paths';
import { loadUserData } from 'src/storage/user-data';

let watcher: fs.FSWatcher | null = null;

export function startUserDataWatcher() {
	if ( watcher ) {
		return;
	}

	const filePath = getUserDataFilePath();

	const fsEventHandler = ( eventType: string ) => {
		loadAndUpdateUserData();
		if ( eventType === 'rename' && watcher ) {
			watcher.close();
			watcher = fs.watch( filePath, fsEventHandler );
		}
	};

	watcher = fs.watch( filePath, fsEventHandler );

	getMainWindow().then( ( mainWindow ) => {
		if ( mainWindow.webContents.isLoading() ) {
			mainWindow.webContents.once( 'did-finish-load', () => {
				loadAndUpdateUserData();
			} );
		} else {
			loadAndUpdateUserData();
		}
	} );
}

export function stopUserDataWatcher() {
	if ( watcher ) {
		watcher.close();
		watcher = null;
	}
}

async function loadAndUpdateUserData() {
	try {
		const userData = await loadUserData();
		const mainWindow = await getMainWindow();
		if ( ! mainWindow.isDestroyed() && ! mainWindow.webContents.isDestroyed() ) {
			mainWindow.webContents.send( 'user-data-updated', userData );
		}
	} catch ( error ) {
		const errMsg = error instanceof Error ? error.message : 'Failed to load user data';
		const mainWindow = await getMainWindow();
		if ( ! mainWindow.isDestroyed() && ! mainWindow.webContents.isDestroyed() ) {
			mainWindow.webContents.send( 'user-data-error', errMsg );
		}
	}
}
