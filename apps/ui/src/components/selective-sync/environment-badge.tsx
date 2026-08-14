import { __ } from '@wordpress/i18n';
import { cx } from '@/components/selective-sync/lib/cx';
import {
	getEnvironmentLabel,
	EnvironmentType,
} from '@/components/selective-sync/lib/environment-utils';
import { Badge } from '@/components/selective-sync/primitives/badge';

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
			return 'bg-white text-frame-theme';
		}

		const classes: Record< string, string > = {
			production: 'bg-[#ceead6] text-[#1a6928]',
			staging: 'bg-[#fef0c7] text-[#93590c]',
			development: 'text-development-text bg-development-bg',
		};

		return classes[ type ] || 'bg-frame-surface text-frame-text-secondary';
	};

	return (
		<Badge className={ cx( getClassName(), className ) }>{ getEnvironmentLabel( type ) }</Badge>
	);
}

export const StudioBadge = ( { className }: { className?: string } ) => {
	return (
		<Badge className={ cx( 'bg-frame-surface text-frame-text-secondary', className ) }>
			{ __( 'Studio' ) }
		</Badge>
	);
};
