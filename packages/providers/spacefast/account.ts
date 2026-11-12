import { __ } from '@wordpress/i18n';
import { InvalidCredentialError } from '../errors';
import { SpacefastApiError, startDeviceLogin, waitForDeviceLogin } from './api';
import type { SpacefastConfig } from './config';
import type { Provider } from '../types';

export const startSpacefastConnect: NonNullable< Provider< SpacefastConfig >[ 'startConnect' ] > =
	startDeviceLogin;

// Takes back the device sign-in `startConnect` returned, and resolves once the user approves it.
export const connectSpacefast: Provider< SpacefastConfig >[ 'connect' ] = async ( input ) => {
	const interval = Number( input.interval );
	if ( ! input.deviceCode || ! input.expiresAt || ! interval ) {
		throw new InvalidCredentialError( __( 'Start signing in to Spacefast again.' ) );
	}
	try {
		return await waitForDeviceLogin( {
			deviceCode: input.deviceCode,
			interval,
			expiresAt: input.expiresAt,
		} );
	} catch ( error ) {
		if ( error instanceof SpacefastApiError && error.status === 403 ) {
			throw new InvalidCredentialError(
				error.code === 'expired'
					? __( 'The Spacefast sign-in expired. Try again.' )
					: __( 'Spacefast sign-in was declined.' ),
				'denied'
			);
		}
		throw new InvalidCredentialError(
			error instanceof Error ? error.message : String( error ),
			'unverified'
		);
	}
};
