import { __ } from '@wordpress/i18n';
import { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

export const getSiteEnvironment = ( connectedSite: SyncSite ): string => {
	if ( connectedSite.isPressable ) {
		return connectedSite.environmentType ?? 'production';
	}
	return connectedSite.isStaging ? 'staging' : 'production';
};

export const getEnvironmentLabel = ( type: string ): string => {
	const labels: Record< string, string > = {
		staging: __( 'Staging' ),
		sandbox: __( 'Sandbox' ),
		production: __( 'Production' ),
	};
	return labels[ type ] || type.charAt( 0 ).toUpperCase() + type.slice( 1 );
};
