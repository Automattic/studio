import { __ } from '@wordpress/i18n';
import { arrowDown } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import styles from './style.module.css';

interface ScrollToBottomButtonProps {
	visible: boolean;
	onClick: () => void;
}

// Floating down arrow pinned above the composer; fades/slides in whenever
// the user scrolls away from the bottom of the conversation.
export function ScrollToBottomButton( { visible, onClick }: ScrollToBottomButtonProps ) {
	return (
		<IconButton
			type="button"
			className={ styles.root }
			variant="outline"
			tone="neutral"
			size="compact"
			icon={ arrowDown }
			label={ __( 'Scroll to bottom' ) }
			positioner={ <Tooltip.Positioner side="top" /> }
			data-visible={ visible ? 'true' : 'false' }
			aria-hidden={ ! visible }
			tabIndex={ visible ? 0 : -1 }
			onClick={ onClick }
		/>
	);
}
