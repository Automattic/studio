import { Icon } from '@wordpress/components';
import { commentAuthorAvatar } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useAuth } from '../hooks/use-auth';
import { useGravatarUrl } from '../hooks/use-gravatar-url';
import { cx } from '../lib/cx';

export function Gravatar( { className }: { className?: string } ) {
	const { __ } = useI18n();
	const { user } = useAuth();
	const gravatarUrl = useGravatarUrl( user?.email );

	return gravatarUrl ? (
		<img
			src={ gravatarUrl }
			alt={ __( 'Avatar' ) }
			className={ cx( 'w-[18px] h-[18px] rounded-full', className ) }
		/>
	) : (
		<Icon icon={ commentAuthorAvatar } />
	);
}
