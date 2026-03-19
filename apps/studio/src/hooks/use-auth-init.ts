import { useI18n } from '@wordpress/react-i18n';
import { useEffect } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useI18nLocale } from 'src/stores';
import { authTokenReceived, initializeAuth } from 'src/stores/auth-slice';

export function useAuthInit() {
	const dispatch = useAppDispatch();
	const locale = useI18nLocale();
	const { __ } = useI18n();

	useEffect( () => {
		void dispatch( initializeAuth( { locale } ) );
	}, [ dispatch, locale ] );

	useIpcListener( 'auth-updated', ( _event, payload ) => {
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

		void dispatch( authTokenReceived( { token: payload.token, locale } ) );
	} );
}
