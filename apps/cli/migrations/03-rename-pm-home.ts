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

export const renameProcessManagerHome: Migration = {
	needsToRun: async () => {
		return fs.existsSync( getLegacyPmHome() ) && ! fs.existsSync( getNewPmHome() );
	},
	run: async () => {
		fs.renameSync( getLegacyPmHome(), getNewPmHome() );
	},
};
