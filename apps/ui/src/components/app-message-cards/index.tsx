import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { XIcon } from 'lucide-react';
import { AddAiCreditsButton } from '@/components/add-ai-credits-button';
import {
	Alert,
	AlertActions,
	AlertDescription,
	AlertTitle,
	INTENT_VARIANTS,
} from '@/components/ui/alert';
import { Button, IconButton } from '@/components/ui/button';
import {
	useActivePersistentMessages,
	useRecordPersistentMessages,
} from '@/data/queries/use-app-messages';
import styles from './style.module.css';

export function AppMessageCards( { className }: { className?: string } ) {
	const { messages, dismiss } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return (
		<div className={ clsx( styles.stack, className ) }>
			{ messages.map( ( message ) => (
				<div key={ message.id } className={ styles.cell }>
					<Alert variant={ INTENT_VARIANTS[ message.intent ] } className={ styles.card }>
						<AlertTitle className={ styles.title }>{ message.title }</AlertTitle>
						<IconButton
							variant="ghost"
							size="icon-2xs"
							icon={ <XIcon /> }
							label={ __( 'Dismiss' ) }
							tooltip={ false }
							className={ styles.close }
							onClick={ () => dismiss( message ) }
						/>
						{ message.description ? (
							<AlertDescription className={ styles.description }>
								{ message.description }
							</AlertDescription>
						) : null }
						{ message.purchaseCta ? (
							<AlertActions>
								<AddAiCreditsButton variant="muted" size="2xs" className={ styles.action } />
							</AlertActions>
						) : message.cta ? (
							<AlertActions>
								<Button
									variant="muted"
									size="2xs"
									className={ styles.action }
									onClick={ message.cta.onClick }
								>
									{ message.cta.label }
								</Button>
							</AlertActions>
						) : null }
					</Alert>
				</div>
			) ) }
		</div>
	);
}

export function AppMessageCardsDot( { className }: { className?: string } ) {
	const { messages } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return <span className={ clsx( styles.dot, className ) } aria-hidden="true" />;
}

// Separate from the cards so logging continues while the sidebar is collapsed.
export function AppMessageHistoryRecorder() {
	useRecordPersistentMessages();
	return null;
}
