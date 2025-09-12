import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

const EnvironmentSchema = z.enum( [ 'production', 'staging', 'development', 'local' ] );
export type EnvironmentType = z.infer< typeof EnvironmentSchema >;

export const getSiteEnvironment = ( site: SyncSite ): EnvironmentType => {
	if ( site.isPressable ) {
		const parsed = EnvironmentSchema.safeParse( site.environmentType );
		return parsed.success ? parsed.data : 'production';
	}
	return site.isStaging ? 'staging' : 'production';
};

export const getEnvironmentLabel = ( type: EnvironmentType ): string => {
	const labels: Record< EnvironmentType, string > = {
		production: __( 'Production' ),
		staging: __( 'Staging' ),
		development: __( 'Development' ),
		local: __( 'Local' ),
	};
	return labels[ type ] || type.charAt( 0 ).toUpperCase() + type.slice( 1 );
};
