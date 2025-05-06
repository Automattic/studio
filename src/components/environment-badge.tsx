import { __ } from '@wordpress/i18n';
import { Badge } from 'src/components/badge';
import { cx } from 'src/lib/cx';

export type EnvironmentType = 'production' | 'staging';

interface EnvironmentBadgeProps {
	type: EnvironmentType;
	selected?: boolean;
}

/**
 * A badge component for displaying environment types (production, staging)
 */
export function EnvironmentBadge( { type, selected }: EnvironmentBadgeProps ) {
	const getClassName = () => {
		if ( selected ) {
			return 'bg-white text-a8c-blueberry text-a8c-blueberry';
		}

		if ( type === 'production' ) {
			return 'bg-a8c-green-5 text-a8c-green-80';
		}

		return '';
	};

	const getLabel = () => {
		if ( type === 'production' ) {
			return __( 'Production' );
		} else if ( type === 'staging' ) {
			return __( 'Staging' );
		}

		return __( 'Production' );
	};

	return <Badge className={ cx( getClassName() ) }>{ getLabel() }</Badge>;
}
