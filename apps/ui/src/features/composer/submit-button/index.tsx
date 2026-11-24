import { IconButton } from '@studio/ds';
import { ArrowUpIcon, PlayIcon, SquareIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import styles from './style.module.css';
import type { SubmitFeedback } from '@studio/ds/hooks';

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
			className={ styles.edgeAction }
			onClick={ onSend }
			disabled={ ! canSend }
			label={ label }
			shortcut={ { ariaKeyShortcut: 'Enter', displayShortcut: '↵' } }
			icon={ <ArrowUpIcon /> }
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
			className={ styles.edgeAction }
			label={ isStarting ? __( 'Starting site' ) : __( 'Start site' ) }
			icon={ <PlayIcon filled /> }
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
			variant="accent"
			size="icon"
			className={ styles.stopButton }
			onClick={ onStop }
			label={ isInterrupting ? __( 'Force stop' ) : __( 'Stop response' ) }
			icon={ <SquareIcon fill="currentColor" /> }
			aria-busy={ isInterrupting }
		/>
	);
}
