import { __ } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { DeskHeaderIconButton } from './header-button';

interface DeskChatsButtonProps {
	open: boolean;
	onToggle: () => void;
}

export function DeskChatsButton( { open, onToggle }: DeskChatsButtonProps ) {
	return (
		<DeskHeaderIconButton
			icon={ comment }
			label={ open ? __( 'Hide conversations' ) : __( 'Show conversations' ) }
			aria-pressed={ open }
			onClick={ onToggle }
		/>
	);
}
