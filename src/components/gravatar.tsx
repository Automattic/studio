import { Icon } from '@wordpress/components';
import { commentAuthorAvatar } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useGravatarUrl } from '../hooks/use-gravatar-url';
import { cx } from '../lib/cx';

export function Gravatar( {
	className,
	isBlack = false,
	isLarge = false,
}: {
	className?: string;
	isBlack?: boolean;
	isLarge?: boolean;
} ) {
	const { __ } = useI18n();
	const { user } = useAuth();
	const gravatarUrl = useGravatarUrl( user?.email, isBlack );
	const [ imageError, setImageError ] = useState( false );

	const childClassName = cx(
		isLarge ? 'w-[32px] h-[32px] rounded-full' : 'w-[18px] h-[18px] rounded-full',
		className
	);

	const renderDefaultGravatarIcon = () => (
		<Icon
			icon={ commentAuthorAvatar }
			viewBox={ '4 4 16 16' }
			size={ isLarge ? 32 : 18 }
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
		/>
	);
}
