/**
 * @vitest-environment node
 */
import { readFile, writeFile } from 'atomically';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleAuthDeeplink } from 'src/lib/deeplink/handlers/auth';

const mockWpcomGet = vi.fn();

vi.mock( 'src/lib/certificate-manager', () => ( {} ) );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/lib/wpcom-factory', () => ( {
	default: () => ( {
		req: { get: mockWpcomGet },
	} ),
} ) );
vi.mock( 'src/lib/wpcom-xhr-request-factory', () => ( {
	default: vi.fn(),
} ) );

describe( 'handleAuthDeeplink', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( { sites: [] } ) ) );
		vi.mocked( writeFile ).mockResolvedValue( undefined );
	} );

	it( 'should handle successful authentication', async () => {
		mockWpcomGet.mockResolvedValue( {
			ID: 123,
			email: 'user@example.com',
			display_name: 'Test User',
		} );

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
		mockWpcomGet.mockRejectedValue( new Error( 'API Error' ) );

		const url = new URL( 'wp-studio://auth#access_token=mock-token&expires_in=3600' );
		await handleAuthDeeplink( url );

		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith( 'auth-updated', {
			error: expect.any( Error ),
		} );
		expect( writeFile ).not.toHaveBeenCalled();
	} );
} );
