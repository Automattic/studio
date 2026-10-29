import { __ } from '@wordpress/i18n';
import { SendIcon, StopSiteIcon } from '@/lib/icons';
import { Button } from '@/lib/ui';
import styles from './style.module.css';
import type { SubmitFeedback } from '@/features/composer/use-submit-feedback';

export function SendButton( {
	label,
	canSend,
	feedback,
	onSend,
}: {
	label: string;
	canSend: boolean;
	feedback: SubmitFeedback;
	onSend: () => void;
} ) {
	return (
		<Button
			variant={ feedback ? 'destructive' : 'accent' }
			size="icon"
			shape="round"
			onClick={ onSend }
			disabled={ ! canSend }
			aria-label={ label }
		>
			<SendIcon />
		</Button>
	);
}

export function StopButton( {
	isInterrupting,
	onStop,
}: {
	isInterrupting: boolean;
	onStop: () => void;
} ) {
	return (
		<Button
			variant="accent"
			size="icon"
			shape="round"
			className={ styles.stopButton }
			onClick={ onStop }
			aria-label={ isInterrupting ? __( 'Force stop' ) : __( 'Stop response' ) }
			aria-busy={ isInterrupting }
		>
			<StopSiteIcon fill="currentColor" />
		</Button>
	);
}
