import { __ } from '@wordpress/i18n';
import { Badge } from 'src/components/badge';
import { cx } from 'src/lib/cx';

type EnvironmentType = 'production' | 'staging' | 'sandbox';

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

		if ( type === 'sandbox' ) {
			return 'text-sandbox-text bg-sandbox-bg';
		}

		return '';
	};

	const labels: Record< EnvironmentType, string > = {
		staging: __( 'Staging' ),
		sandbox: __( 'Sandbox' ),
		production: __( 'Production' ),
	};

	return <Badge className={ cx( getClassName() ) }>{ labels[ type ] }</Badge>;
}
