import { __ } from '@wordpress/i18n';
import { Badge } from 'src/components/badge';
import { cx } from 'src/lib/cx';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

export type EnvironmentType = 'production' | 'staging' | 'sandbox' | 'studio';

interface EnvironmentBadgeProps {
	type: EnvironmentType;
	selected?: boolean;
	className?: string;
}

/**
 * A badge component for displaying environment types (production, staging)
 */
export function EnvironmentBadge( { type, selected, className }: EnvironmentBadgeProps ) {
	const getClassName = () => {
		if ( selected ) {
			return 'bg-white text-a8c-blueberry text-a8c-blueberry';
		}

		if ( type === 'production' ) {
			return 'bg-a8c-green-5 text-a8c-green-80';
		}

		if ( type === 'sandbox' ) {
			return 'text-sandbox-text bg-sandbox-bg';
		}

		if ( type === 'studio' ) {
			return 'bg-a8c-gray-5 text-a8c-gray-80';
		}

		return 'text-a8c-yellow-80 bg-a8c-yellow-10';
	};

	const labels: Record< EnvironmentType, string > = {
		staging: __( 'Staging' ),
		sandbox: __( 'Sandbox' ),
		production: __( 'Production' ),
		studio: __( 'Studio' ),
	};

	return <Badge className={ cx( getClassName(), className ) }>{ labels[ type ] }</Badge>;
}

export const getSiteEnvironment = ( connectedSite: SyncSite ): EnvironmentType => {
	if ( connectedSite.isPressable ) {
		return connectedSite.environmentType ?? 'production';
	}
	return connectedSite.isStaging ? 'staging' : 'production';
};
