/**
 * Before `cliUserUninstalled` existed, an absent CLI symlink/directory combined
 * with `cliAutoInstalled: true` was the only signal that the user had uninstalled
 * the CLI via Settings. This migration converts that implicit state into the
 * explicit `cliUserUninstalled: true` flag so that `autoInstallIfNeeded` can
 * simply check `cliUserUninstalled` without having to reason about the old state.
 */

import fs, { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

const cliSymlinkPath = path.join( os.homedir(), '.local', 'bin', 'studio' );

function isWindowsCliAbsent(): boolean {
	if ( process.platform !== 'win32' ) {
		return false;
	}
	// Inline the stable bin dir path rather than importing from windows-installation-manager
	// to avoid pulling in Electron's `app` module at migration load time on other platforms.
	const stableBinDirPath = path.resolve( path.dirname( process.execPath ), '../bin' );
	return ! existsSync( stableBinDirPath );
}

async function isUnixCliSymlinkAbsent(): Promise< boolean > {
	try {
		await fs.promises.lstat( cliSymlinkPath );
		return false;
	} catch {
		return true;
	}
}

export const setCliUserUninstalled: Migration = {
	async needsToRun() {
		const userData = await loadUserData();
		if ( ! userData.cliAutoInstalled || userData.cliUserUninstalled !== undefined ) {
			return false;
		}
		if ( process.platform === 'win32' ) {
			return isWindowsCliAbsent();
		}
		return await isUnixCliSymlinkAbsent();
	},
	async run() {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			userData.cliUserUninstalled = true;
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	},
};
