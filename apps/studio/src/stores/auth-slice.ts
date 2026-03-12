import { createAsyncThunk, createSlice, isAnyOf } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { isInvalidTokenError } from 'src/lib/is-invalid-oauth-token-error';
import { store, RootState } from 'src/stores';
import { getWpcomClient, setWpcomClient } from 'src/stores/wpcom-api';
import type { StoredToken } from 'src/lib/oauth';
import type { WPCOM } from 'wpcom/types';

interface WpcomParams extends Record< string, unknown > {
	query?: string;
	apiNamespace?: string;
}

export type AuthUser = { id: number; email: string; displayName: string };

type AuthState = {
	isAuthenticated: boolean;
	user: AuthUser | null;
};

const initialState: AuthState = {
	isAuthenticated: false,
	user: null,
};

function createWpcomClient( token?: string, locale?: string, onInvalidToken?: () => void ): WPCOM {
	let isAuthErrorDialogOpen = false;
	const handleInvalidTokenError = async ( response: unknown ) => {
		if ( isInvalidTokenError( response ) && onInvalidToken && ! isAuthErrorDialogOpen ) {
			isAuthErrorDialogOpen = true;
			onInvalidToken();
			await getIpcApi().showMessageBox( {
				type: 'error',
				message: 'Session Expired',
				detail: 'Your session has expired. Please log in again.',
			} );
			isAuthErrorDialogOpen = false;
		}
	};

	const addLocaleToParams = ( params: WpcomParams ) => {
		if ( locale && locale !== 'en' ) {
			const queryParams = new URLSearchParams(
				'query' in params && typeof params.query === 'string' ? params.query : ''
			);
			const localeParamName =
				'apiNamespace' in params && typeof params.apiNamespace === 'string' ? '_locale' : 'locale';
			queryParams.set( localeParamName, locale );

			Object.assign( params, {
				query: queryParams.toString(),
			} );
		}
		return params;
	};

	const wrappedRequestHandler = (
		params: object,
		callback: ( err: unknown, response?: unknown, headers?: unknown ) => void
	) => {
		const modifiedParams = addLocaleToParams( params as WpcomParams );
		const wrappedCallback = ( err: unknown, response: unknown, headers: unknown ) => {
			if ( err ) {
				void handleInvalidTokenError( err );
			}
			if ( typeof callback === 'function' ) {
				callback( err, response, headers );
			}
		};

		return wpcomXhrRequest( modifiedParams, wrappedCallback );
	};

	return wpcomFactory( token, wrappedRequestHandler );
}

const createTypedAsyncThunk = createAsyncThunk.withTypes< { state: RootState } >();

export const handleInvalidToken = createTypedAsyncThunk( 'auth/handleInvalidToken', async () => {
	try {
		void getIpcApi().logRendererMessage( 'info', 'Detected invalid token. Logging out.' );
		await getIpcApi().clearAuthenticationToken();
		setWpcomClient( undefined );
	} catch ( err ) {
		console.error( 'Failed to handle invalid token:', err );
		Sentry.captureException( err );
	}
} );

export const initializeAuth = createTypedAsyncThunk(
	'auth/initialize',
	async ( { locale }: { locale?: string } ) => {
		try {
			const token = await getIpcApi().getAuthenticationToken();

			if ( ! token ) {
				return null;
			}

			const client = createWpcomClient( token.accessToken, locale, () =>
				store.dispatch( handleInvalidToken() )
			);
			setWpcomClient( client );

			return {
				id: token.id,
				email: token.email,
				displayName: token.displayName || '',
			};
		} catch ( err ) {
			console.error( err );
			Sentry.captureException( err );
			return null;
		}
	}
);

export const authTokenReceived = createTypedAsyncThunk(
	'auth/tokenReceived',
	async ( { token, locale }: { token: StoredToken; locale?: string } ) => {
		const client = createWpcomClient( token.accessToken, locale, () =>
			store.dispatch( handleInvalidToken() )
		);
		setWpcomClient( client );

		return {
			id: token.id,
			email: token.email,
			displayName: token.displayName || '',
		};
	}
);

export const authLogout = createTypedAsyncThunk(
	'auth/logout',
	async ( { isOffline }: { isOffline: boolean } ) => {
		const client = getWpcomClient();

		if ( ! isOffline && client ) {
			try {
				await client.req.del( {
					apiNamespace: 'wpcom/v2',
					path: '/studio-app/token',
					method: 'DELETE',
				} );
				console.log( 'Token revoked' );
			} catch ( err ) {
				console.error( 'Failed to revoke token:', err );
				Sentry.captureException( err );
			}
		} else if ( isOffline ) {
			console.log( 'Offline: Skipping token revocation request' );
		}

		try {
			await getIpcApi().clearAuthenticationToken();
			setWpcomClient( undefined );
		} catch ( err ) {
			console.error( err );
			Sentry.captureException( err );
		}
	}
);

const authSlice = createSlice( {
	name: 'auth',
	initialState,
	reducers: {},
	extraReducers: ( builder ) => {
		builder
			.addCase( initializeAuth.fulfilled, ( state, action ) => {
				state.isAuthenticated = !! action.payload;
				state.user = action.payload ?? null;
			} )
			.addCase( authTokenReceived.fulfilled, ( state, action ) => {
				state.isAuthenticated = true;
				state.user = action.payload;
			} )
			.addMatcher( isAnyOf( handleInvalidToken.fulfilled, authLogout.fulfilled ), ( state ) => {
				state.isAuthenticated = false;
				state.user = null;
			} );
	},
} );

export const selectIsAuthenticated = ( state: RootState ) => state.auth.isAuthenticated;
export const selectUser = ( state: RootState ) => state.auth.user ?? undefined;

export default authSlice.reducer;
