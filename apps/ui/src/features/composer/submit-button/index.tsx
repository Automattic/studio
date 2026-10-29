import { __ } from '@wordpress/i18n';
import { SendIcon, StartSiteIcon, StopSiteIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
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
		<IconButton
			variant={ feedback ? 'destructive' : 'accent' }
			size="icon"
			shape="round"
			onClick={ onSend }
			disabled={ ! canSend }
			label={ label }
			icon={ <SendIcon /> }
		/>
	);
}

export function StartButton( {
	disabled,
	isStarting,
	onStart,
}: {
	disabled: boolean;
	isStarting: boolean;
	onStart: () => void;
} ) {
	return (
		<IconButton
			variant="accent"
			size="icon"
			shape="round"
			label={ isStarting ? __( 'Starting site' ) : __( 'Start site' ) }
			icon={ <StartSiteIcon /> }
			loading={ isStarting }
			loadingMode="replace"
			disabled={ disabled }
			onClick={ onStart }
		/>
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
		<IconButton
			variant="default"
			size="icon"
			shape="round"
			className={ styles.stopButton }
			onClick={ onStop }
			label={ isInterrupting ? __( 'Force stop' ) : __( 'Stop response' ) }
			icon={ <StopSiteIcon fill="currentColor" /> }
			aria-busy={ isInterrupting }
		/>
	);
}
