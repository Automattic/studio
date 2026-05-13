import { __ } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { Button } from '@/ui-desks/components';

interface ChatsButtonProps {
	open: boolean;
	onToggle: () => void;
}

export function ChatsButton( { open, onToggle }: ChatsButtonProps ) {
	return (
		<Button
			icon={ comment }
			label={ open ? __( 'Hide conversations' ) : __( 'Show conversations' ) }
			aria-pressed={ open }
			onClick={ onToggle }
		/>
	);
}
