import { existsSync } from 'node:fs';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { lockAppdata, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

async function readAppConfig() {
	const appConfigPath = getAppConfigPath();
	if ( ! existsSync( appConfigPath ) ) {
		return null;
	}

	try {
		const raw = await readFile( appConfigPath, { encoding: 'utf8' } );
		const parsed = JSON.parse( raw );
		return isRecord( parsed ) ? parsed : null;
	} catch {
		return null;
	}
}

function hasDesksConfig( config: Record< string, unknown > ) {
	return Object.prototype.hasOwnProperty.call( config, 'desks' );
}

export const removeDesksConfig: Migration = {
	async needsToRun() {
		const config = await readAppConfig();
		return !! config && hasDesksConfig( config );
	},
	async run() {
		try {
			await lockAppdata();
			const config = await readAppConfig();
			if ( ! config || ! hasDesksConfig( config ) ) {
				return;
			}

			const { desks: _desks, ...rest } = config;
			await writeFile( getAppConfigPath(), JSON.stringify( rest, null, 2 ) + '\n', {
				encoding: 'utf8',
			} );
		} finally {
			await unlockAppdata();
		}
	},
};
