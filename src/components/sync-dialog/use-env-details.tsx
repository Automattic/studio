import { useI18n } from '@wordpress/react-i18n';
import type { EnvironmentType } from 'src/components/environment-badge';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

export const useEnvDetails = (
	connectedSite: SyncSite
): { label: string; envType: EnvironmentType; fillClass: string } => {
	const { __ } = useI18n();

	const envTypeValues = {
		production: {
			label: __( 'Production' ),
			envType: 'production',
			fillClass: 'fill-circle-env-production',
		},
		staging: {
			label: __( 'Staging' ),
			envType: 'staging',
			fillClass: 'fill-circle-env-staging',
		},
		sandbox: {
			label: __( 'Sandbox' ),
			envType: 'sandbox',
			fillClass: 'fill-sandbox-text',
		},
	} as const;

	if ( connectedSite.isPressable ) {
		return (
			envTypeValues[ connectedSite.environmentType as EnvironmentType ] ?? envTypeValues.production
		);
	}

	if ( connectedSite.isStaging ) {
		return envTypeValues.staging;
	} else {
		return envTypeValues.production;
	}
};
