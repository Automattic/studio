import { Icon } from '@wordpress/components';
import { commentAuthorAvatar } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useAuth } from '../hooks/use-auth';
import { cx } from '../lib/cx';

export function Gravatar( { className }: { className?: string } ) {
	const { __ } = useI18n();
	const { user } = useAuth();
	return user?.avatarUrl ? (
		<img
			src={ user.avatarUrl }
			alt={ __( 'Avatar' ) }
			className={ cx( 'w-6 h-6 rounded-full', className ) }
		/>
	) : (
		<Icon icon={ commentAuthorAvatar } />
	);
}
