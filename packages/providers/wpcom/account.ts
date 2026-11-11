import type { WpcomConfig } from './config';
import type { Provider } from '../types';

// Connected exactly when the user is signed in to Studio.
export const wpcomAccount: Provider< WpcomConfig >[ 'account' ] = {
	status: ( config ) => ( {
		connected: config !== undefined,
		method: config ? 'studio' : null,
		credentialPreview: null,
	} ),
};
