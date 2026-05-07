import { __ } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import styles from './style.module.css';

interface DeskChatsButtonProps {
	open: boolean;
	onToggle: () => void;
}

export function DeskChatsButton( { open, onToggle }: DeskChatsButtonProps ) {
	return (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			className={ styles.trigger }
			icon={ comment }
			label={ open ? __( 'Hide conversations' ) : __( 'Show conversations' ) }
			aria-pressed={ open }
			onClick={ onToggle }
		/>
	);
}
