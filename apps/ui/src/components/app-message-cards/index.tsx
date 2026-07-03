import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
// Shared surface treatment imported directly (not CSS-module `composes`,
// which detaches the class hash from HMR updates and serves stale styles).
import toastStyles from '@/components/app-toasts/style.module.css';
import { useActivePersistentMessages } from '@/data/queries/use-app-messages';
import styles from './style.module.css';

// Persistent cards in the sidebar footer: condition-driven messages (app
// update ready, announcements) that stay until acted on or dismissed. See
// data/queries/use-app-messages.ts for the sources.
export function AppMessageCards( { className }: { className?: string } ) {
	const { messages, dismiss } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return (
		<div className={ clsx( styles.stack, className ) }>
			{ messages.map( ( message ) => (
				<Notice.Root
					key={ message.id }
					intent={ message.intent }
					// Cards skip the intent icon — marketing and update messages
					// read as content, not status.
					icon={ null }
					className={ clsx( toastStyles.notice, styles.card ) }
				>
					<Notice.Title>{ message.title }</Notice.Title>
					{ message.description ? (
						<Notice.Description>{ message.description }</Notice.Description>
					) : null }
					{ message.cta ? (
						<Notice.Actions>
							{ /* Notice.ActionButton doesn't expose `size`; the plain
							     Button primitive does. */ }
							<Button
								size="small"
								variant="solid"
								tone="neutral"
								className={ toastStyles.actionButton }
								onClick={ message.cta.onClick }
							>
								{ message.cta.label }
							</Button>
						</Notice.Actions>
					) : null }
					<Notice.CloseIcon label={ __( 'Dismiss' ) } onClick={ () => dismiss( message ) } />
				</Notice.Root>
			) ) }
		</div>
	);
}

// Presence indicator for the collapsed sidebar's floating toggle: a small
// dot signaling that cards are waiting in the (hidden) footer.
export function AppMessageCardsDot( { className }: { className?: string } ) {
	const { messages } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return <span className={ clsx( styles.dot, className ) } aria-hidden="true" />;
}
