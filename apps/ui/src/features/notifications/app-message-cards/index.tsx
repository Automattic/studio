import { clsx } from 'clsx';
import {
	useActivePersistentMessages,
	useRecordPersistentMessages,
} from '@/data/queries/use-app-messages';
import { AddAiCreditsButton } from '@/features/credits';
import { NoticeCard } from '@/features/notifications/notice-card';
import { Button } from '@/lib/ui';
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
					<NoticeCard
						notice={ { ...message, source: 'studio' } }
						// The card's own button: NoticeCard's runs an action only while a toast or
						// the history still offers it, and cards are neither.
						action={
							message.purchaseCta ? (
								<AddAiCreditsButton variant="outline" size="2xs" />
							) : message.action ? (
								<Button variant="outline" size="2xs" onClick={ message.action.onClick }>
									{ message.action.label }
								</Button>
							) : undefined
						}
						onDismiss={ () => dismiss( message ) }
					/>
				</div>
			) ) }
		</div>
	);
}

export function AppMessageCardsDot() {
	const { messages } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return <span className={ styles.dot } aria-hidden="true" />;
}

// Separate from the cards so logging continues while the sidebar is collapsed.
export function AppMessageHistoryRecorder() {
	useRecordPersistentMessages();
	return null;
}
