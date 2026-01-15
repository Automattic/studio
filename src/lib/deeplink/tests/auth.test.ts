/**
 * @vitest-environment node
 */
import { readFile, writeFile } from 'atomically';
import { vi, type Mock } from 'vitest';
import { WPCOM } from 'wpcom/types';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { handleAuthDeeplink } from 'src/lib/deeplink/handlers/auth';
import wpcomFactory from 'src/lib/wpcom-factory';

vi.mock( 'src/lib/certificate-manager', () => ( {} ) );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/lib/wpcom-factory' );
vi.mock( 'src/lib/wpcom-xhr-request-factory', () => ( {
	default: vi.fn(),
} ) );

describe( 'handleAuthDeeplink', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		( readFile as Mock ).mockResolvedValue( JSON.stringify( { sites: [] } ) );
		( writeFile as Mock ).mockResolvedValue( undefined );
	} );

	it( 'should handle successful authentication', async () => {
		const mockWpcomGet = vi.fn().mockResolvedValue( {
			ID: 123,
			email: 'user@example.com',
			display_name: 'Test User',
		} );
		vi.mocked( wpcomFactory ).mockReturnValue( {
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
		const mockWpcomGet = vi.fn().mockRejectedValue( new Error( 'API Error' ) );
		vi.mocked( wpcomFactory ).mockReturnValue( {
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
