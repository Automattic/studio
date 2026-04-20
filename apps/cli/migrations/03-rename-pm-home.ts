import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Migration } from '@studio/common/lib/migration';

function getStudioCliHome(): string {
	return path.join( os.homedir(), '.studio' );
}

function getLegacyPmHome(): string {
	return path.join( getStudioCliHome(), 'pm2' );
}

function getNewPmHome(): string {
	return path.join( getStudioCliHome(), 'daemon' );
}

function mergeLogs( legacy: string, target: string ) {
	const legacyLogs = path.join( legacy, 'logs' );
	if ( ! fs.existsSync( legacyLogs ) ) {
		return;
	}
	const targetLogs = path.join( target, 'logs' );
	fs.mkdirSync( targetLogs, { recursive: true } );
	for ( const entry of fs.readdirSync( legacyLogs ) ) {
		const src = path.join( legacyLogs, entry );
		const dest = path.join( targetLogs, entry );
		if ( ! fs.existsSync( dest ) ) {
			fs.renameSync( src, dest );
		}
	}
}

export const renameProcessManagerHome: Migration = {
	needsToRun: async () => {
		return fs.existsSync( getLegacyPmHome() );
	},
	run: async () => {
		const legacy = getLegacyPmHome();
		const target = getNewPmHome();

		if ( ! fs.existsSync( target ) ) {
			fs.renameSync( legacy, target );
			return;
		}

		mergeLogs( legacy, target );
		fs.rmSync( legacy, { recursive: true, force: true } );
	},
};
