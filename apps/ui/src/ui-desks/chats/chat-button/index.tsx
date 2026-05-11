import { __ } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { IconControlButton } from '@/ui-desks/components';
import styles from './style.module.css';

interface ChatButtonProps {
	onClick: () => void;
}

export function ChatButton( { onClick }: ChatButtonProps ) {
	return (
		<IconControlButton
			icon={ comment }
			className={ styles.button }
			label={ __( 'Chat about selection' ) }
			variant="toolbar"
			onClick={ onClick }
		/>
	);
}
