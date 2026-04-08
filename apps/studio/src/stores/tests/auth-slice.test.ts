import * as Sentry from '@sentry/electron/renderer';
import { vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import * as sentryUtils from 'src/lib/renderer-sentry-utils';
import { store } from 'src/stores';
import {
	authLogout,
	authTokenReceived,
	handleInvalidToken,
	initializeAuth,
	selectIsAuthenticated,
	selectUser,
} from 'src/stores/auth-slice';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import { getWpcomClient, setWpcomClient } from 'src/stores/wpcom-client';
import type { StoredAuthToken } from 'src/lib/oauth';

vi.mock( 'src/lib/get-ipc-api' );

vi.mock( '@sentry/electron/renderer', () => ( {
	captureException: vi.fn(),
	setTag: vi.fn(),
} ) );

vi.mock( 'src/lib/renderer-sentry-utils', () => ( {
	setSentryWpcomUserIdRenderer: vi.fn(),
} ) );

const mockClientDel = vi.hoisted( () => vi.fn().mockResolvedValue( undefined ) );

vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	default: vi.fn( () => ( { req: { del: mockClientDel } } ) ),
} ) );

vi.mock( '@studio/common/lib/wpcom-xhr-request-factory', () => ( {
	default: vi.fn(),
} ) );

store.replaceReducer( testReducer );

const mockToken: StoredAuthToken = {
	accessToken: 'test-access-token',
	expiresIn: 3600,
	expirationTime: Date.now() + 3_600_000,
	id: 123,
	email: 'test@example.com',
	displayName: 'Test User',
};

function setupIpcMocks( overrides: Partial< ReturnType< typeof getIpcApi > > = {} ) {
	vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
		getAuthenticationToken: vi.fn().mockResolvedValue( null ),
		clearAuthenticationToken: vi.fn().mockResolvedValue( undefined ),
		showMessageBox: vi.fn().mockResolvedValue( undefined ),
		showErrorMessageBox: vi.fn().mockResolvedValue( undefined ),
		logRendererMessage: vi.fn().mockResolvedValue( undefined ),
		...overrides,
	} );
}

describe( 'auth-slice', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		store.dispatch( testActions.resetState() );
		setWpcomClient( undefined );
		setupIpcMocks();
	} );

	describe( 'initializeAuth', () => {
		it( 'sets isAuthenticated to false when no token exists', async () => {
			const result = await store.dispatch( initializeAuth() );

			expect( result.type ).toBe( 'auth/initialize/fulfilled' );
			expect( result.payload ).toBeNull();

			const state = store.getState();
			expect( selectIsAuthenticated( state ) ).toBe( false );
			expect( selectUser( state ) ).toBeUndefined();
		} );

		it( 'sets isAuthenticated and user when token exists', async () => {
			setupIpcMocks( {
				getAuthenticationToken: vi.fn().mockResolvedValue( mockToken ),
			} );

			await store.dispatch( initializeAuth() );

			const state = store.getState();
			expect( selectIsAuthenticated( state ) ).toBe( true );
			expect( selectUser( state ) ).toEqual( {
				id: mockToken.id,
				email: mockToken.email,
				displayName: mockToken.displayName,
			} );
		} );

		it( 'creates wpcom client and tracks Sentry user id when token exists', async () => {
			setupIpcMocks( {
				getAuthenticationToken: vi.fn().mockResolvedValue( mockToken ),
			} );

			await store.dispatch( initializeAuth() );

			expect( getWpcomClient() ).toBeDefined();
			expect( sentryUtils.setSentryWpcomUserIdRenderer ).toHaveBeenCalledWith( mockToken.id );
		} );

		it( 'returns null and captures Sentry exception when token fetch throws', async () => {
			const error = new Error( 'IPC error' );
			setupIpcMocks( {
				getAuthenticationToken: vi.fn().mockRejectedValue( error ),
			} );

			const result = await store.dispatch( initializeAuth() );

			expect( result.payload ).toBeNull();
			expect( Sentry.captureException ).toHaveBeenCalledWith( error );

			const state = store.getState();
			expect( selectIsAuthenticated( state ) ).toBe( false );
		} );
	} );

	describe( 'authTokenReceived', () => {
		it( 'sets isAuthenticated and user when token received', async () => {
			await store.dispatch( authTokenReceived( { token: mockToken } ) );

			const state = store.getState();
			expect( selectIsAuthenticated( state ) ).toBe( true );
			expect( selectUser( state ) ).toEqual( {
				id: mockToken.id,
				email: mockToken.email,
				displayName: mockToken.displayName,
			} );
		} );

		it( 'creates wpcom client and tracks Sentry user id', async () => {
			await store.dispatch( authTokenReceived( { token: mockToken } ) );

			expect( getWpcomClient() ).toBeDefined();
			expect( sentryUtils.setSentryWpcomUserIdRenderer ).toHaveBeenCalledWith( mockToken.id );
		} );

		it( 'uses empty string for displayName when not provided', async () => {
			const tokenWithoutName = { ...mockToken, displayName: '' };
			await store.dispatch( authTokenReceived( { token: tokenWithoutName } ) );

			expect( selectUser( store.getState() )?.displayName ).toBe( '' );
		} );
	} );

	describe( 'authLogout', () => {
		beforeEach( async () => {
			await store.dispatch( authTokenReceived( { token: mockToken } ) );
			vi.clearAllMocks();
			setupIpcMocks();
		} );

		it( 'revokes token and clears auth state when online', async () => {
			const result = await store.dispatch( authLogout( { isOffline: false } ) );

			expect( result.type ).toBe( 'auth/logout/fulfilled' );
			expect( mockClientDel ).toHaveBeenCalledWith( {
				apiNamespace: 'wpcom/v2',
				path: '/studio-app/token',
				method: 'DELETE',
			} );
			expect( getIpcApi().clearAuthenticationToken ).toHaveBeenCalled();
			expect( getWpcomClient() ).toBeUndefined();
			expect( sentryUtils.setSentryWpcomUserIdRenderer ).toHaveBeenCalledWith( undefined );

			const state = store.getState();
			expect( selectIsAuthenticated( state ) ).toBe( false );
			expect( selectUser( state ) ).toBeUndefined();
		} );

		it( 'skips token revocation when offline', async () => {
			await store.dispatch( authLogout( { isOffline: true } ) );

			expect( mockClientDel ).not.toHaveBeenCalled();
			expect( getIpcApi().clearAuthenticationToken ).toHaveBeenCalled();
		} );

		it( 'still clears local auth state when token revocation request fails', async () => {
			mockClientDel.mockRejectedValueOnce( new Error( 'Network error' ) );

			await store.dispatch( authLogout( { isOffline: false } ) );

			expect( getIpcApi().clearAuthenticationToken ).toHaveBeenCalled();
			expect( getWpcomClient() ).toBeUndefined();
			expect( selectIsAuthenticated( store.getState() ) ).toBe( false );
		} );
	} );

	describe( 'handleInvalidToken', () => {
		beforeEach( async () => {
			await store.dispatch( authTokenReceived( { token: mockToken } ) );
			vi.clearAllMocks();
			setupIpcMocks();
		} );

		it( 'clears auth state, wpcom client and Sentry user', async () => {
			await store.dispatch( handleInvalidToken() );

			expect( getIpcApi().clearAuthenticationToken ).toHaveBeenCalled();
			expect( getWpcomClient() ).toBeUndefined();
			expect( sentryUtils.setSentryWpcomUserIdRenderer ).toHaveBeenCalledWith( undefined );

			const state = store.getState();
			expect( selectIsAuthenticated( state ) ).toBe( false );
			expect( selectUser( state ) ).toBeUndefined();
		} );

		it( 'shows session expired message box', async () => {
			await store.dispatch( handleInvalidToken() );

			expect( getIpcApi().showMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( { type: 'error' } )
			);
		} );

		it( 'prevents duplicate dialogs when called concurrently', async () => {
			const firstCall = store.dispatch( handleInvalidToken() );
			const secondCall = store.dispatch( handleInvalidToken() );

			await Promise.all( [ firstCall, secondCall ] );

			expect( getIpcApi().showMessageBox ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'allows a new dialog after the first one is dismissed', async () => {
			await store.dispatch( handleInvalidToken() );
			await store.dispatch( handleInvalidToken() );

			expect( getIpcApi().showMessageBox ).toHaveBeenCalledTimes( 2 );
		} );
	} );

} );
