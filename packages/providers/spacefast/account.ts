import { __ } from '@wordpress/i18n';
import { ConnectError } from '../errors';
import { SpacefastApiError, startDeviceLogin, waitForDeviceLogin } from './api';
import type { SpacefastConfig } from './config';
import type { ProviderServices } from '../types';

export const spacefastAccount: ProviderServices< SpacefastConfig >[ 'account' ] = {
	async start() {
		const login = await startDeviceLogin();
		return {
			url: login.verificationUrl,
			code: login.userCode,
			handoff: {
				deviceCode: login.deviceCode,
				interval: String( login.interval ),
				expiresAt: login.expiresAt,
			},
		};
	},

	// Takes back the handoff `start` returned, and resolves once the user approves the sign-in.
	async connect( _method, input ) {
		const interval = Number( input.interval );
		if ( ! input.deviceCode || ! input.expiresAt || ! interval ) {
			throw new ConnectError( __( 'Start signing in to Spacefast again.' ) );
		}
		try {
			return await waitForDeviceLogin( {
				deviceCode: input.deviceCode,
				interval,
				expiresAt: input.expiresAt,
			} );
		} catch ( error ) {
			if ( error instanceof SpacefastApiError && error.status === 403 ) {
				throw new ConnectError(
					error.code === 'expired'
						? __( 'The Spacefast sign-in expired. Try again.' )
						: __( 'Spacefast sign-in was declined.' ),
					'denied'
				);
			}
			throw new ConnectError(
				error instanceof Error ? error.message : String( error ),
				'unverified'
			);
		}
	},
};
