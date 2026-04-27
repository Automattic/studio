import { createAsyncThunk, createSlice, isAnyOf } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { __ } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { isInvalidTokenError } from 'src/lib/is-invalid-oauth-token-error';
import { setSentryWpcomUserIdRenderer } from 'src/lib/renderer-sentry-utils';
import { store } from 'src/stores';
import { getWpcomClient, setWpcomClient } from 'src/stores/wpcom-client';
import type { StoredAuthToken } from 'src/lib/oauth';
import type { RootState } from 'src/stores';
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

function createWpcomClient( token?: string, onInvalidToken?: () => void ): WPCOM {
	const addLocaleToParams = ( params: WpcomParams ) => {
		const locale = store.getState().i18n.locale;
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
			if ( err && isInvalidTokenError( err ) && onInvalidToken && ! isAuthErrorDialogOpen ) {
				void onInvalidToken();
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

let isAuthErrorDialogOpen = false;

export const handleInvalidToken = createTypedAsyncThunk( 'auth/handleInvalidToken', async () => {
	if ( isAuthErrorDialogOpen ) {
		return;
	}
	isAuthErrorDialogOpen = true;
	try {
		void getIpcApi().logRendererMessage( 'info', 'Detected invalid token. Logging out.' );
		await getIpcApi().clearAuthenticationToken();
		setWpcomClient( undefined );
		setSentryWpcomUserIdRenderer( undefined );
		await getIpcApi().showMessageBox( {
			type: 'error',
			message: __( 'Session Expired' ),
			detail: __( 'Your session has expired. Please log in again.' ),
		} );
	} catch ( err ) {
		console.error( 'Failed to handle invalid token:', err );
	} finally {
		isAuthErrorDialogOpen = false;
	}
} );

export const initializeAuth = createTypedAsyncThunk(
	'auth/initialize',
	async ( _, { dispatch } ) => {
		try {
			const token = await getIpcApi().getAuthenticationToken();

			if ( ! token ) {
				return null;
			}

			const client = createWpcomClient( token.accessToken, () => dispatch( handleInvalidToken() ) );
			setWpcomClient( client );
			setSentryWpcomUserIdRenderer( token.id );

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
	async ( { token }: { token: StoredAuthToken }, { dispatch } ) => {
		const client = createWpcomClient( token.accessToken, () => dispatch( handleInvalidToken() ) );
		setWpcomClient( client );
		setSentryWpcomUserIdRenderer( token.id );

		return {
			id: token.id,
			email: token.email,
			displayName: token.displayName || '',
		};
	}
);

export const authLogout = createTypedAsyncThunk( 'auth/logout', async () => {
	const client = getWpcomClient();

	if ( navigator.onLine && client ) {
		try {
			await client.req.del( {
				apiNamespace: 'wpcom/v2',
				path: '/studio-app/token',
				method: 'DELETE',
			} );
			console.log( 'Token revoked' );
		} catch ( err ) {
			console.error( 'Failed to revoke token:', err );
		}
	} else if ( ! navigator.onLine ) {
		console.log( 'Offline: Skipping token revocation request' );
	}

	try {
		await getIpcApi().clearAuthenticationToken();
		setWpcomClient( undefined );
		setSentryWpcomUserIdRenderer( undefined );
	} catch ( err ) {
		console.error( err );
	}
} );

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

export const authThunks = {
	handleInvalidToken,
	initializeAuth,
	authTokenReceived,
	authLogout,
};

export const authSelectors = {
	selectIsAuthenticated: ( state: RootState ) => state.auth.isAuthenticated,
	selectUser: ( state: RootState ) => state.auth.user ?? undefined,
};

void store.dispatch( initializeAuth() );

window.ipcListener.subscribe( 'auth-updated', ( _event, payload ) => {
	if ( 'error' in payload ) {
		let title: string = __( 'Authentication error' );
		let message: string = __( 'Please try again.' );

		if ( payload.error instanceof Error && payload.error.message.includes( 'access_denied' ) ) {
			title = __( 'Authorization denied' );
			message = __(
				'It looks like you denied the authorization request. To proceed, please click "Approve"'
			);
		}

		void getIpcApi().showErrorMessageBox( { title, message } );
		return;
	}

	if ( ! payload.token ) {
		void store.dispatch( authLogout() );
		return;
	}

	void store.dispatch( authTokenReceived( { token: payload.token } ) );
} );

export default authSlice.reducer;
