import fs from 'fs';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getMainWindow } from 'src/main-window';
import { getUserDataFilePath } from 'src/storage/paths';
import { loadUserData } from 'src/storage/user-data';

let watcher: fs.FSWatcher | null = null;

export async function startUserDataWatcher() {
	if ( watcher ) {
		return;
	}

	const filePath = getUserDataFilePath();

	const fsEventHandler = async ( eventType: string ) => {
		await loadAndUpdateUserData();
		if ( eventType === 'rename' && watcher ) {
			watcher.close();
			watcher = fs.watch( filePath, fsEventHandler );
		}
	};

	watcher = fs.watch( filePath, fsEventHandler );

	const mainWindow = await getMainWindow();
	if ( mainWindow.webContents.isLoading() ) {
		mainWindow.webContents.once( 'did-finish-load', () => {
			void loadAndUpdateUserData();
		} );
	} else {
		void loadAndUpdateUserData();
	}
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
		await sendIpcEventToRenderer( 'user-data-updated', userData );
	} catch ( error ) {
		const errMsg = error instanceof Error ? error.message : 'Failed to load user data';
		await sendIpcEventToRenderer( 'user-data-error', errMsg );
	}
}
