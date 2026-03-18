import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { vi } from 'vitest';
import {
	readSharedConfig,
	saveSharedConfig,
	updateSharedConfig,
	readAuthToken,
	getCurrentUserId,
	getSharedConfigDirectory,
	getSharedConfigPath,
} from '@studio/common/lib/shared-config';

vi.mock( 'fs', () => ( {
	default: {
		existsSync: vi.fn(),
		mkdirSync: vi.fn(),
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
	},
} ) );
vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/lockfile', () => ( {
	lockFileAsync: vi.fn().mockResolvedValue( undefined ),
	unlockFileAsync: vi.fn().mockResolvedValue( undefined ),
} ) );

const validToken = {
	accessToken: 'valid-token',
	expiresIn: 1209600,
	expirationTime: Date.now() + 1000 * 60 * 60 * 24, // 1 day from now
	id: 123,
	email: 'test@example.com',
	displayName: 'Test User',
};

const expiredToken = {
	...validToken,
	expirationTime: Date.now() - 1000, // 1 second ago
};

describe( 'Shared Config', () => {
	const mockHomeDir = '/mock/home';

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( os.homedir ).mockReturnValue( mockHomeDir );
		vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( '{}' ) );
		vi.mocked( writeFile ).mockResolvedValue( undefined );
		delete process.env.E2E;
		delete process.env.E2E_SHARED_CONFIG_PATH;
	} );

	describe( 'getSharedConfigDirectory', () => {
		it( 'should return ~/.studio by default', () => {
			expect( getSharedConfigDirectory() ).toBe( `${ mockHomeDir }/.studio` );
		} );

		it( 'should use E2E override when set', () => {
			process.env.E2E = '1';
			process.env.E2E_SHARED_CONFIG_PATH = '/custom/path';
			expect( getSharedConfigDirectory() ).toBe( '/custom/path' );
		} );
	} );

	describe( 'getSharedConfigPath', () => {
		it( 'should return path to shared.json', () => {
			expect( getSharedConfigPath() ).toBe( `${ mockHomeDir }/.studio/shared.json` );
		} );
	} );

	describe( 'readSharedConfig', () => {
		it( 'should return default config when file does not exist', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			const config = await readSharedConfig();
			expect( config ).toEqual( { version: 1 } );
		} );

		it( 'should parse valid shared.json', async () => {
			const data = {
				version: 1,
				authToken: validToken,
				locale: 'en',
			};
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

			const config = await readSharedConfig();
			expect( config.authToken?.accessToken ).toBe( 'valid-token' );
			expect( config.locale ).toBe( 'en' );
		} );

		it( 'should return defaults on malformed JSON', async () => {
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( 'not json' ) );
			const config = await readSharedConfig();
			expect( config ).toEqual( { version: 1 } );
		} );

		it( 'should return defaults on invalid schema', async () => {
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from( JSON.stringify( { version: 'invalid' } ) )
			);
			const config = await readSharedConfig();
			expect( config ).toEqual( { version: 1 } );
		} );

		it( 'should warn when version differs from current', async () => {
			const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
			const data = { version: 2, authToken: validToken };
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

			const config = await readSharedConfig();
			expect( config.authToken?.accessToken ).toBe( 'valid-token' );
			expect( warnSpy ).toHaveBeenCalledWith(
				expect.stringContaining( 'newer version of Studio' )
			);
			warnSpy.mockRestore();
		} );

		it( 'should not warn when version matches', async () => {
			const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
			const data = { version: 1, authToken: validToken };
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

			await readSharedConfig();
			expect( warnSpy ).not.toHaveBeenCalled();
			warnSpy.mockRestore();
		} );

		it( 'should preserve unknown fields with loose schema', async () => {
			const data = { version: 1, unknownField: 'value' };
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( data ) ) );

			const config = await readSharedConfig();
			expect( ( config as Record< string, unknown > ).unknownField ).toBe( 'value' );
		} );
	} );

	describe( 'saveSharedConfig', () => {
		it( 'should write JSON to shared.json', async () => {
			const config = { version: 1, locale: 'en' };
			await saveSharedConfig( config );

			expect( writeFile ).toHaveBeenCalledWith(
				`${ mockHomeDir }/.studio/shared.json`,
				JSON.stringify( { version: 1, locale: 'en' }, null, 2 ) + '\n',
				{ encoding: 'utf8' }
			);
		} );

		it( 'should create directory if it does not exist', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			await saveSharedConfig( { version: 1 } );

			expect( fs.mkdirSync ).toHaveBeenCalledWith( `${ mockHomeDir }/.studio`, {
				recursive: true,
			} );
		} );

		it( 'should set version to 1', async () => {
			const config = { version: 99 as number };
			await saveSharedConfig( config );

			const written = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ] as string;
			expect( JSON.parse( written ).version ).toBe( 1 );
		} );
	} );

	describe( 'updateSharedConfig', () => {
		it( 'should merge partial updates', async () => {
			const existing = { version: 1, locale: 'en' };
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( existing ) ) );

			await updateSharedConfig( { locale: 'fr' } );

			const written = vi.mocked( writeFile ).mock.calls[ 0 ][ 1 ] as string;
			const saved = JSON.parse( written );
			expect( saved.locale ).toBe( 'fr' );
		} );
	} );

	describe( 'readAuthToken', () => {
		it( 'should return valid token', async () => {
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from( JSON.stringify( { version: 1, authToken: validToken } ) )
			);

			const token = await readAuthToken();
			expect( token ).not.toBeNull();
			expect( token?.accessToken ).toBe( 'valid-token' );
			expect( token?.id ).toBe( 123 );
		} );

		it( 'should return null for expired token', async () => {
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from( JSON.stringify( { version: 1, authToken: expiredToken } ) )
			);

			const token = await readAuthToken();
			expect( token ).toBeNull();
		} );

		it( 'should return null when no token exists', async () => {
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( { version: 1 } ) ) );

			const token = await readAuthToken();
			expect( token ).toBeNull();
		} );

		it( 'should return null when file does not exist', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );

			const token = await readAuthToken();
			expect( token ).toBeNull();
		} );

		it( 'should return null on malformed file', async () => {
			vi.mocked( readFile ).mockResolvedValue( Buffer.from( 'not json' ) );

			const token = await readAuthToken();
			expect( token ).toBeNull();
		} );
	} );

	describe( 'getCurrentUserId', () => {
		it( 'should return user id from valid token', async () => {
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from( JSON.stringify( { version: 1, authToken: validToken } ) )
			);

			const userId = await getCurrentUserId();
			expect( userId ).toBe( 123 );
		} );

		it( 'should return null when no token', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );

			const userId = await getCurrentUserId();
			expect( userId ).toBeNull();
		} );

		it( 'should return null for expired token', async () => {
			vi.mocked( readFile ).mockResolvedValue(
				Buffer.from( JSON.stringify( { version: 1, authToken: expiredToken } ) )
			);

			const userId = await getCurrentUserId();
			expect( userId ).toBeNull();
		} );
	} );
} );
