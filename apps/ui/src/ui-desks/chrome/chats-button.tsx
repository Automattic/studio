import { __ } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { IconControlButton } from '@/ui-desks/components';

interface DeskChatsButtonProps {
	open: boolean;
	onToggle: () => void;
}

export function DeskChatsButton( { open, onToggle }: DeskChatsButtonProps ) {
	return (
		<IconControlButton
			icon={ comment }
			label={ open ? __( 'Hide conversations' ) : __( 'Show conversations' ) }
			aria-pressed={ open }
			onClick={ onToggle }
		/>
	);
}
