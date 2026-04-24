import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
	unlockAppdata,
} from '@studio/common/lib/user-data';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';

describe( 'user data', () => {
	let configDirectory: string;

	beforeEach( () => {
		configDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-user-data-' ) );
		process.env.DEV_CONFIG_DIR = configDirectory;
	} );

	afterEach( () => {
		delete process.env.DEV_CONFIG_DIR;
		fs.rmSync( configDirectory, { recursive: true, force: true } );
	} );

	it( 'returns defaults when app.json does not exist', async () => {
		await expect( loadUserData() ).resolves.toEqual( {
			version: 1,
			siteMetadata: {},
		} );
	} );

	it( 'normalizes version to 1 and defaults siteMetadata', async () => {
		fs.writeFileSync(
			getAppConfigPath(),
			JSON.stringify( {
				version: 42,
				onboardingCompleted: true,
			} )
		);

		await expect( loadUserData() ).resolves.toEqual( {
			version: 1,
			siteMetadata: {},
			onboardingCompleted: true,
		} );
	} );

	it( 'reads beta features from app.json', async () => {
		fs.writeFileSync(
			getAppConfigPath(),
			JSON.stringify( {
				version: 1,
				siteMetadata: {},
				betaFeatures: { pullReprint: true },
			} )
		);

		const userData = await loadUserData();
		expect( userData.betaFeatures?.pullReprint ).toBe( true );
	} );

	it( 'calls onInvalidJson and throws when app.json is malformed', async () => {
		fs.writeFileSync( getAppConfigPath(), '{not json' );
		const onInvalidJson = vi.fn();

		await expect( loadUserData( { onInvalidJson } ) ).rejects.toThrow( SyntaxError );
		expect( onInvalidJson ).toHaveBeenCalledOnce();
		const [ err, fileContents, filePath ] = onInvalidJson.mock.calls[ 0 ];
		expect( err ).toBeInstanceOf( SyntaxError );
		expect( fileContents ).toBe( '{not json' );
		expect( filePath ).toBe( getAppConfigPath() );
	} );

	it( 'round-trips data through saveUserData/loadUserData', async () => {
		try {
			await lockAppdata();
			await saveUserData( {
				version: 1,
				siteMetadata: {},
				betaFeatures: { pullReprint: true },
			} );
		} finally {
			await unlockAppdata();
		}

		const userData = await loadUserData();
		expect( userData.betaFeatures?.pullReprint ).toBe( true );
	} );
} );
