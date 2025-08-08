import { __ } from '@wordpress/i18n';
import { Badge } from 'src/components/badge';
import { cx } from 'src/lib/cx';
import { getEnvironmentLabel, EnvironmentType } from 'src/modules/sync/lib/environment-utils';

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
			return 'bg-white text-a8c-blue-50 text-a8c-blue-50';
		}

		const classes: Record< string, string > = {
			production: 'bg-a8c-green-5 text-a8c-green-80',
			staging: 'text-a8c-yellow-80 bg-a8c-yellow-10',
			development: 'text-development-text bg-development-bg',
		};

		return classes[ type ] || 'text-a8c-gray-80 bg-a8c-gray-10';
	};

	return (
		<Badge className={ cx( getClassName(), className ) }>{ getEnvironmentLabel( type ) }</Badge>
	);
}

export const StudioBadge = ( { className }: { className?: string } ) => {
	return (
		<Badge className={ cx( 'bg-a8c-gray-5 text-a8c-gray-80', className ) }>
			{ __( 'Studio' ) }
		</Badge>
	);
};
