import { clsx } from 'clsx';
import {
	useActivePersistentMessages,
	useRecordPersistentMessages,
} from '@/data/queries/use-app-messages';
import { AddAiCreditsButton } from '@/features/credits';
import { NoticeCard } from '@/features/notifications/notice-card';
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
						notice={ message }
						action={
							message.purchaseCta ? <AddAiCreditsButton variant="default" size="sm" /> : undefined
						}
						onDismiss={ () => dismiss( message ) }
					/>
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
