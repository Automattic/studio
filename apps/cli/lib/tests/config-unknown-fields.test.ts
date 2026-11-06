import fs from 'fs';
import os from 'os';
import path from 'path';
import * as shared from '@studio/common/lib/shared-config';
import { expect, it } from 'vitest';
import * as cli from 'cli/lib/cli-config/core';

it( 'keeps fields a newer build added to previews and connected sites', async () => {
	const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-config-' ) );
	process.env.DEV_CONFIG_DIR = directory;
	const file = ( name: string, content?: object ) =>
		content
			? fs.writeFileSync( path.join( directory, name ), JSON.stringify( content ) )
			: JSON.parse( fs.readFileSync( path.join( directory, name ), 'utf8' ) );
	const newer = { fromNewerBuild: 1 };
	file( 'cli.json', {
		version: 1,
		snapshots: [ { url: 'p.example.com', atomicSiteId: 1, localSiteId: 'a', date: 1, ...newer } ],
	} );
	file( 'shared.json', {
		version: 1,
		connectedWpcomSites: {
			'1': [
				{
					id: 1,
					localSiteId: 'a',
					name: 'Site',
					url: 'https://example.com',
					isStaging: false,
					isPressable: false,
					syncSupport: 'already-connected',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
					...newer,
				},
			],
		},
	} );

	try {
		await cli.lockCliConfig();
		await cli.saveCliConfig( await cli.readCliConfig() );
	} finally {
		await cli.unlockCliConfig();
	}
	try {
		await shared.lockSharedConfig();
		await shared.saveSharedConfig( await shared.readSharedConfig() );
	} finally {
		await shared.unlockSharedConfig();
	}

	expect( file( 'cli.json' ).snapshots[ 0 ] ).toMatchObject( newer );
	expect( file( 'shared.json' ).connectedWpcomSites[ '1' ][ 0 ] ).toMatchObject( newer );
	delete process.env.DEV_CONFIG_DIR;
	fs.rmSync( directory, { recursive: true } );
} );
