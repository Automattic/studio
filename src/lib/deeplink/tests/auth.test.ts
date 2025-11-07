/**
 * @jest-environment node
 */
import { readFile, writeFile } from 'atomically';
import { WPCOM } from 'wpcom/types';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleAuthDeeplink } from 'src/lib/deeplink/handlers/auth';
import wpcomFactory from 'src/lib/wpcom-factory';

jest.mock( 'src/lib/certificate-manager', () => ( {} ) );
jest.mock( 'src/ipc-utils' );
jest.mock( 'atomically', () => ( {
	readFile: jest.fn(),
	writeFile: jest.fn(),
} ) );
jest.mock( 'src/lib/wpcom-factory' );
jest.mock( 'src/lib/wpcom-xhr-request-factory', () => jest.fn() );

describe( 'handleAuthDeeplink', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( { sites: [] } ) );
		( writeFile as jest.Mock ).mockResolvedValue( undefined );
	} );

	it( 'should handle successful authentication', async () => {
		const mockWpcomGet = jest.fn().mockResolvedValue( {
			ID: 123,
			email: 'user@example.com',
			display_name: 'Test User',
		} );
		jest.mocked( wpcomFactory ).mockReturnValue( {
			req: { get: mockWpcomGet },
		} as unknown as WPCOM );

		const url = new URL( 'wp-studio://auth#access_token=mock-token&expires_in=3600' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			token: expect.objectContaining( {
				accessToken: 'mock-token',
				expiresIn: 3600,
				id: 123,
				email: 'user@example.com',
				displayName: 'Test User',
			} ),
		} );
		expect( writeFile ).toHaveBeenCalled();
	} );

	it( 'should handle authentication error from WordPress.com', async () => {
		const url = new URL( 'wp-studio://auth#error=access_denied' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			error: new Error( 'access_denied' ),
		} );
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'should handle invalid token response', async () => {
		const url = new URL( 'wp-studio://auth#access_token=mock-token&expires_in=invalid' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			error: expect.any( Error ),
		} );
		expect( writeFile ).not.toHaveBeenCalled();
	} );

	it( 'should handle wpcom API error', async () => {
		const mockWpcomGet = jest.fn().mockRejectedValue( new Error( 'API Error' ) );
		jest.mocked( wpcomFactory ).mockReturnValue( {
			req: { get: mockWpcomGet },
		} as unknown as WPCOM );

		const url = new URL( 'wp-studio://auth#access_token=mock-token&expires_in=3600' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			error: expect.any( Error ),
		} );
		expect( writeFile ).not.toHaveBeenCalled();
	} );
} );
