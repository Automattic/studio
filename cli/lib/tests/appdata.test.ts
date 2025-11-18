import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { arePathsEqual } from 'common/lib/fs-utils';
import { StatsMetric } from 'common/types/stats';
import {
	readAppdata,
	saveAppdata,
	getAuthToken,
	getNewSitePartial,
	getOrCreateSiteByFolder,
	lockAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';

jest.mock( 'fs' );
jest.mock( 'os' );
jest.mock( 'path' );
jest.mock( 'atomically', () => ( {
	readFile: jest.fn(),
	writeFile: jest.fn(),
} ) );
jest.mock( 'crypto', () => ( {
	randomUUID: jest.fn().mockReturnValue( 'mock-uuid-1234' ),
} ) );

jest.mock( 'common/lib/fs-utils' );
jest.mock( 'cli/lib/api', () => ( {
	validateAccessToken: jest.fn().mockResolvedValue( undefined ),
} ) );

describe( 'Appdata Module', () => {
	const mockHomeDir = '/mock/home';
	const mockSiteFolderName = 'folder';

	beforeEach( () => {
		jest.clearAllMocks();
		( os.homedir as jest.Mock ).mockReturnValue( mockHomeDir );
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
		( path.basename as jest.Mock ).mockReturnValue( mockSiteFolderName );
		( path.resolve as jest.Mock ).mockImplementation( ( path ) => path );
		jest.spyOn( Date, 'now' ).mockReturnValue( 1234567890 );

		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( arePathsEqual as jest.Mock ).mockImplementation( ( path1, path2 ) => path1 === path2 );
		( readFile as jest.Mock ).mockResolvedValue( '{}' );
		( writeFile as jest.Mock ).mockResolvedValue( undefined );
	} );

	describe( 'readAppdata', () => {
		it( 'should throw LoggerError if appdata file does not exist', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( false );
			await expect( readAppdata() ).rejects.toThrow( 'Studio config file not found' );
		} );

		it( 'should return parsed appdata if it exists and is valid', async () => {
			const mockUserData = {
				version: 1,
				newSites: [],
				sites: [],
				snapshots: [
					{
						url: 'example.com',
						atomicSiteId: 123,
						name: 'Example site',
						localSiteId: 'site1',
						date: 1234567,
					},
				],
			};

			( readFile as jest.Mock ).mockResolvedValueOnce( JSON.stringify( mockUserData ) );

			const result = await readAppdata();
			expect( result ).toEqual( mockUserData );
		} );

		it( 'should correctly validate lastBumpStats with local-environment-launch-uniques key', async () => {
			const mockUserData = {
				version: 1,
				newSites: [],
				sites: [],
				snapshots: [],
				lastBumpStats: {
					'local-environment-launch-uniques': {
						[ StatsMetric.DARWIN ]: 5,
					},
				},
			};

			( readFile as jest.Mock ).mockResolvedValueOnce( JSON.stringify( mockUserData ) );

			const result = await readAppdata();
			expect( result ).toEqual( mockUserData );
		} );

		it( 'should throw LoggerError if there is an error reading the file', async () => {
			( readFile as jest.Mock ).mockRejectedValue( new Error( 'Read error' ) );

			await expect( readAppdata() ).rejects.toThrow( 'Failed to read Studio config file' );
		} );

		it( 'should throw LoggerError if there is an error parsing the JSON', async () => {
			( readFile as jest.Mock ).mockResolvedValueOnce( 'invalid json{' );

			await expect( readAppdata() ).rejects.toThrow( 'corrupted' );
		} );
	} );

	describe( 'saveAppdata', () => {
		it( 'should save the userData to the appdata file', async () => {
			const mockUserData = {
				version: 1,
				newSites: [],
				sites: [],
				snapshots: [],
			};

			try {
				await lockAppdata();
				await saveAppdata( mockUserData );
			} finally {
				await unlockAppdata();
			}

			expect( writeFile ).toHaveBeenCalledWith(
				expect.any( String ),
				JSON.stringify( mockUserData, null, 2 ) + '\n',
				{ encoding: 'utf8' }
			);
		} );

		it( 'should throw LoggerError if there is an error saving the file', async () => {
			const mockUserData = {
				version: 1,
				newSites: [],
				sites: [],
				snapshots: [],
			};

			( writeFile as jest.Mock ).mockRejectedValue( new Error( 'Write error' ) );

			try {
				await lockAppdata();
				await expect( saveAppdata( mockUserData ) ).rejects.toThrow(
					'Failed to save Studio config file'
				);
			} finally {
				await unlockAppdata();
			}
		} );

		it( 'should add version 1 if version is not provided', async () => {
			const mockUserData = {
				newSites: [],
				sites: [],
				snapshots: [],
			};

			try {
				await lockAppdata();
				await saveAppdata( mockUserData );
			} finally {
				await unlockAppdata();
			}

			expect( writeFile ).toHaveBeenCalled();
			const savedData = JSON.parse( ( writeFile as jest.Mock ).mock.calls[ 0 ][ 1 ] );
			expect( savedData.version ).toBe( 1 );
		} );
	} );

	describe( 'getAuthToken', () => {
		it( 'should return auth token when it exists', async () => {
			const mockAuthToken = {
				accessToken: 'valid-token',
				displayName: 'User Name',
				email: 'user@example.com',
				expirationTime: Date.now() + 3600000, // 1 hour in the future
				expiresIn: 3600,
				id: 123,
			};

			( readFile as jest.Mock ).mockResolvedValueOnce(
				JSON.stringify( {
					version: 1,
					authToken: mockAuthToken,
					sites: [],
					snapshots: [],
				} )
			);

			const result = await getAuthToken();
			expect( result ).toEqual( mockAuthToken );
		} );

		it( 'should throw LoggerError when auth token is missing', async () => {
			( readFile as jest.Mock ).mockResolvedValueOnce(
				JSON.stringify( {
					version: 1,
					sites: [],
					snapshots: [],
				} )
			);

			await expect( getAuthToken() ).rejects.toThrow( 'Authentication required' );
		} );

		it( 'should throw LoggerError when access token is missing', async () => {
			( readFile as jest.Mock ).mockResolvedValueOnce(
				JSON.stringify( {
					version: 1,
					authToken: {
						id: 123,
					},
					sites: [],
					snapshots: [],
				} )
			);

			await expect( getAuthToken() ).rejects.toThrow( 'Authentication required' );
		} );
	} );

	describe( 'getNewSitePartial', () => {
		it( 'should create a new site object with random UUID', () => {
			const folderPath = '/test/site/path';
			const baseName = 'sitename';

			( path.basename as jest.Mock ).mockReturnValueOnce( baseName );

			const result = getNewSitePartial( folderPath );

			expect( result ).toEqual( {
				id: 'mock-uuid-1234',
				path: folderPath,
				name: baseName,
			} );
		} );
	} );

	describe( 'getOrCreateSiteByFolder', () => {
		it( 'should return an existing site if present on sites', async () => {
			const folderPath = '/existing/site/path';
			const existingSite = {
				id: 'existing-id',
				path: folderPath,
				name: 'existing-site',
				phpVersion: '8.0',
				port: 8881,
			};
			( readFile as jest.Mock ).mockResolvedValueOnce(
				JSON.stringify( { sites: [ existingSite ], newSites: [], snapshots: [] } )
			);
			const site = await getOrCreateSiteByFolder( folderPath );
			expect( site ).toEqual( existingSite );
			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should return an existing site if present on newSites', async () => {
			const folderPath = '/existing/site/path';
			const existingSite = {
				id: 'existing-id',
				path: folderPath,
				name: 'existing-site',
			};
			( readFile as jest.Mock ).mockReturnValueOnce(
				JSON.stringify( { sites: [], newSites: [ existingSite ], snapshots: [] } )
			);
			const site = await getOrCreateSiteByFolder( folderPath );
			expect( site ).toEqual( existingSite );
			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should create and return a new site if not present', async () => {
			const folderPath = '/new/site/path';
			( readFile as jest.Mock ).mockReturnValueOnce(
				JSON.stringify( { sites: [], newSites: [], snapshots: [] } )
			);
			const site = await getOrCreateSiteByFolder( folderPath );
			expect( site ).toEqual( {
				id: 'mock-uuid-1234',
				path: folderPath,
				name: mockSiteFolderName,
			} );
			expect( writeFile ).toHaveBeenCalled();
		} );
	} );
} );
