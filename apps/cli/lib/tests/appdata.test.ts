import fs from 'fs';
import os from 'os';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import {
	readAppdata,
	saveAppdata,
	getAuthToken,
	lockAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { StatsMetric } from 'cli/lib/bump-stat';

vi.mock( 'fs', () => ( {
	default: {
		existsSync: vi.fn(),
	},
} ) );
vi.mock( 'os', () => ( {
	default: {
		homedir: vi.fn(),
	},
} ) );
vi.mock( 'path', () => ( {
	default: {
		join: vi.fn(),
		basename: vi.fn(),
		resolve: vi.fn(),
	},
} ) );
vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/fs-utils', () => ( {
	arePathsEqual: vi.fn(),
} ) );
vi.mock( 'cli/lib/api', () => ( {
	validateAccessToken: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'Appdata Module', () => {
	const mockHomeDir = '/mock/home';
	const mockSiteFolderName = 'folder';

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( os.homedir ).mockReturnValue( mockHomeDir );
		vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
		vi.mocked( path.basename ).mockReturnValue( mockSiteFolderName );
		vi.mocked( path.resolve ).mockImplementation( ( path ) => path );
		vi.spyOn( Date, 'now' ).mockReturnValue( 1234567890 );

		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( arePathsEqual ).mockImplementation( ( path1, path2 ) => path1 === path2 );
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( '{}' ) );
		vi.mocked( writeFile ).mockResolvedValue( undefined );
	} );

	describe( 'readAppdata', () => {
		it( 'should throw LoggerError if appdata file does not exist', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			await expect( readAppdata() ).rejects.toThrow( 'Studio config file not found' );
		} );

		it( 'should return parsed appdata if it exists and is valid', async () => {
			const mockUserData = {
				version: 1,
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

			vi.mocked( readFile ).mockResolvedValueOnce( Buffer.from( JSON.stringify( mockUserData ) ) );

			const result = await readAppdata();
			expect( result ).toEqual( mockUserData );
		} );

		it( 'should correctly validate lastBumpStats with local-environment-launch-uniques key', async () => {
			const mockUserData = {
				version: 1,
				sites: [],
				snapshots: [],
				lastBumpStats: {
					'local-environment-launch-uniques': {
						[ StatsMetric.DARWIN ]: 5,
					},
				},
			};

			vi.mocked( readFile ).mockResolvedValueOnce( Buffer.from( JSON.stringify( mockUserData ) ) );

			const result = await readAppdata();
			expect( result ).toEqual( mockUserData );
		} );

		it( 'should throw LoggerError if there is an error reading the file', async () => {
			vi.mocked( readFile ).mockRejectedValue( new Error( 'Read error' ) );

			await expect( readAppdata() ).rejects.toThrow( 'Failed to read Studio config file' );
		} );

		it( 'should throw LoggerError if there is an error parsing the JSON', async () => {
			vi.mocked( readFile ).mockResolvedValueOnce( Buffer.from( 'invalid json{' ) );

			await expect( readAppdata() ).rejects.toThrow( 'corrupted' );
		} );
	} );

	describe( 'saveAppdata', () => {
		it( 'should save the userData to the appdata file', async () => {
			const mockUserData = {
				version: 1,
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
				sites: [],
				snapshots: [],
			};

			vi.mocked( writeFile ).mockRejectedValue( new Error( 'Write error' ) );

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
			const savedData = JSON.parse( vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ] as string );
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

			vi.mocked( readFile ).mockResolvedValueOnce(
				Buffer.from(
					JSON.stringify( {
						version: 1,
						authToken: mockAuthToken,
						sites: [],
						snapshots: [],
					} )
				)
			);

			const result = await getAuthToken();
			expect( result ).toEqual( mockAuthToken );
		} );

		it( 'should throw LoggerError when auth token is missing', async () => {
			vi.mocked( readFile ).mockResolvedValueOnce(
				Buffer.from(
					JSON.stringify( {
						version: 1,
						sites: [],
						snapshots: [],
					} )
				)
			);

			await expect( getAuthToken() ).rejects.toThrow( 'Authentication required' );
		} );

		it( 'should throw LoggerError when access token is missing', async () => {
			vi.mocked( readFile ).mockResolvedValueOnce(
				Buffer.from(
					JSON.stringify( {
						version: 1,
						authToken: {
							id: 123,
						},
						sites: [],
						snapshots: [],
					} )
				)
			);

			await expect( getAuthToken() ).rejects.toThrow( 'Authentication required' );
		} );
	} );
} );
