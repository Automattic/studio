import { __ } from '@wordpress/i18n';

/**
 * Get a human-readable label for an environment type
 */
export const getEnvironmentLabel = ( type: string ): string => {
	const labels: Record< string, string > = {
		staging: __( 'Staging' ),
		sandbox: __( 'Sandbox' ),
		production: __( 'Production' ),
	};
	return labels[ type ] || type.charAt( 0 ).toUpperCase() + type.slice( 1 );
};
