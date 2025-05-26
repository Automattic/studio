/**
 * @jest-environment node
 */
import { readFile, writeFile } from 'atomically';
import wpcom from 'wpcom';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getAuthenticationToken, onOpenUrlCallback } from 'src/lib/oauth';

jest.mock( 'src/lib/certificate-manager', () => ( {} ) );
jest.mock( 'src/ipc-utils' );
jest.mock( 'atomically', () => ( {
	readFile: jest.fn(),
	writeFile: jest.fn(),
} ) );
jest.mock( 'wpcom' );

describe( 'getAuthenticationToken', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should return valid token', async () => {
		const validToken = {
			accessToken: 'valid-token',
			expiresIn: 3600,
			expirationTime: new Date().getTime() + 3600 * 1000,
			id: 123,
			email: 'user@example.com',
			displayName: 'Test User',
		};
		( readFile as jest.Mock ).mockResolvedValue(
			JSON.stringify( { authToken: validToken, sites: [] } )
		);

		const result = await getAuthenticationToken();
		expect( result ).toEqual( validToken );
	} );

	it( 'should return null for expired token', async () => {
		const expiredToken = {
			accessToken: 'expired-token',
			expiresIn: 3600,
			expirationTime: new Date().getTime() - 1000, // Past time
			id: 123,
			email: 'user@example.com',
			displayName: 'Test User',
		};
		( readFile as jest.Mock ).mockResolvedValue(
			JSON.stringify( { authToken: expiredToken, sites: [] } )
		);

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null for malformed token data', async () => {
		const malformedToken = {
			accessToken: 'token',
			// Missing required fields
		};
		( readFile as jest.Mock ).mockResolvedValue(
			JSON.stringify( { authToken: malformedToken, sites: [] } )
		);

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );

	it( 'should return null when no token exists', async () => {
		( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( { sites: [] } ) );

		const result = await getAuthenticationToken();
		expect( result ).toBeNull();
	} );
} );

describe( 'onOpenUrlCallback', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( { sites: [] } ) );
		( writeFile as jest.Mock ).mockResolvedValue( undefined );
	} );

	describe( 'auth callback', () => {
		it( 'should handle successful authentication', async () => {
			const mockWpcomGet = jest.fn().mockResolvedValue( {
				ID: 123,
				email: 'user@example.com',
				display_name: 'Test User',
			} );
			( wpcom as jest.Mock ).mockReturnValue( {
				req: { get: mockWpcomGet },
			} );

			const url = 'studio://auth#access_token=mock-token&expires_in=3600';
			await onOpenUrlCallback( url );

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
			const url = 'studio://auth#error=access_denied';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
				error: new Error( 'access_denied' ),
			} );
			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle invalid token response', async () => {
			const url = 'studio://auth#access_token=mock-token&expires_in=invalid';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
				error: expect.any( Error ),
			} );
			expect( writeFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle wpcom API error', async () => {
			const mockWpcomGet = jest.fn().mockRejectedValue( new Error( 'API Error' ) );
			( wpcom as jest.Mock ).mockReturnValue( {
				req: { get: mockWpcomGet },
			} );

			const url = 'studio://auth#access_token=mock-token&expires_in=3600';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
				error: expect.any( Error ),
			} );
			expect( writeFile ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'sync-connect-site callback', () => {
		it( 'should handle sync connect site callback', async () => {
			const url = 'studio://sync-connect-site?remoteSiteId=123&studioSiteId=local-site';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'sync-connect-site', {
				remoteSiteId: 123,
				studioSiteId: 'local-site',
			} );
		} );

		it( 'should not send sync connect site event if parameters are missing', async () => {
			const url = 'studio://sync-connect-site?remoteSiteId=123';
			await onOpenUrlCallback( url );

			expect( sendIpcEventToRenderer ).not.toHaveBeenCalled();
		} );
	} );
} );
