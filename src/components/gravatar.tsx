import { Icon } from '@wordpress/components';
import { commentAuthorAvatar } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useGravatarUrl } from '../hooks/use-gravatar-url';
import { cx } from '../lib/cx';
import profileIconDetailed from './profile-icon-detailed';

export function Gravatar( {
	className,
	isBlack = false,
	size = 16,
	detailedDefaultImage = false,
}: {
	className?: string;
	isBlack?: boolean;
	size?: number;
	detailedDefaultImage?: boolean;
} ) {
	const { __ } = useI18n();
	const { user } = useAuth();
	const gravatarUrl = useGravatarUrl( user?.email, isBlack, detailedDefaultImage );
	const [ imageError, setImageError ] = useState( false );

	const childClassName = cx( 'rounded-full', className );

	const renderDefaultGravatarIcon = () => (
		<Icon
			icon={ detailedDefaultImage ? profileIconDetailed : commentAuthorAvatar }
			viewBox={ detailedDefaultImage ? '0 0 32 33' : '4 4 16 16' }
			size={ size }
			className={ childClassName }
		/>
	);

	if ( imageError || ! gravatarUrl ) {
		return renderDefaultGravatarIcon();
	}

	return (
		<img
			src={ gravatarUrl }
			alt={ __( 'User avatar' ) }
			className={ childClassName }
			onError={ () => setImageError( true ) }
			style={ { width: `${ size }px`, height: `${ size }px` } }
		/>
	);
}
