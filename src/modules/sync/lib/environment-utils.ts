import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

const EnvironmentSchema = z.enum( [ 'production', 'staging', 'development', 'local' ] );
export type EnvironmentType = z.infer< typeof EnvironmentSchema >;

export const getSiteEnvironment = ( site: SyncSite ): EnvironmentType => {
	const parsed = EnvironmentSchema.safeParse( site.environmentType );
	return parsed.success ? parsed.data : 'production';
};

export const getEnvironmentLabel = ( type: string ): string => {
	const labels: Record< string, string > = {
		staging: __( 'Staging' ),
		sandbox: __( 'Sandbox' ),
		production: __( 'Production' ),
	};
	return labels[ type ] || type.charAt( 0 ).toUpperCase() + type.slice( 1 );
};
