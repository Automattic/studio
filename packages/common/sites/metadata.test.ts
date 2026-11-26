import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfigPath, readConfig } from '@studio/common/lib/config/store';
import { updateSiteMetadata } from './metadata';

const site = ( id: string, fields: object ) => ( {
	id,
	name: id,
	path: `/sites/${ id }`,
	port: 8881,
	phpVersion: '8.3',
	status: 'ready',
	...fields,
} );

describe( 'site metadata', () => {
	let configDir: string;

	beforeEach( () => {
		configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-site-metadata-' ) );
		process.env.DEV_CONFIG_DIR = configDir;
		writeFileSync(
			getConfigPath(),
			JSON.stringify( {
				version: 1,
				sites: [
					site( 'a', { sortOrder: 2, autoStart: true, futureField: 'kept' } ),
					site( 'b', { sortOrder: 1 } ),
				],
			} )
		);
	} );

	afterEach( () => {
		delete process.env.DEV_CONFIG_DIR;
		rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'merges patches into the site records, keeping unknown fields and ignoring unknown sites', async () => {
		await updateSiteMetadata( { a: { autoStart: false }, c: { sortOrder: 3 } } );

		expect( ( await readConfig() ).sites ).toEqual( [
			site( 'a', { sortOrder: 2, autoStart: false, futureField: 'kept' } ),
			site( 'b', { sortOrder: 1 } ),
		] );
	} );
} );
