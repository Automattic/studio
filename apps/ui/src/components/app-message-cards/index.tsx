import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
// Shared surface treatment imported directly (not CSS-module `composes`,
// which detaches the class hash from HMR updates and serves stale styles).
import toastStyles from '@/components/app-toasts/style.module.css';
import { useActivePersistentMessages } from '@/data/queries/use-app-messages';
import { GettingStartedCard } from './getting-started-card';
import styles from './style.module.css';
import type { PersistentMessage } from '@/data/queries/use-app-messages';

// Matches the cell collapse transition (180ms) plus slack.
const CARD_EXIT_MS = 200;

interface RenderedMessage {
	message: PersistentMessage;
	leaving: boolean;
}

/**
 * Presence tracking for exit animations: cards derive from state and vanish
 * from `messages` instantly on dismissal, so departed cards are kept (frozen)
 * in the render list for CARD_EXIT_MS with a `leaving` flag while the cell
 * collapse plays — mirroring the toast store's two-phase removal.
 */
function useLeavingMessages( messages: PersistentMessage[] ): RenderedMessage[] {
	// Departed message snapshots by id, with the index they occupied so they
	// collapse in place rather than at the end of the stack.
	const [ leaving, setLeaving ] = useState<
		Array< { message: PersistentMessage; index: number } >
	>( [] );
	const previousRef = useRef< PersistentMessage[] >( messages );
	const timersRef = useRef< Map< string, ReturnType< typeof setTimeout > > >( new Map() );

	useEffect( () => {
		const currentIds = new Set( messages.map( ( message ) => message.id ) );
		const departed = previousRef.current
			.map( ( message, index ) => ( { message, index } ) )
			.filter( ( entry ) => ! currentIds.has( entry.message.id ) );
		previousRef.current = messages;
		if ( ! departed.length ) {
			return;
		}
		setLeaving( ( existing ) => {
			const existingIds = new Set( existing.map( ( entry ) => entry.message.id ) );
			return [
				...existing,
				...departed.filter( ( entry ) => ! existingIds.has( entry.message.id ) ),
			];
		} );
		for ( const entry of departed ) {
			const id = entry.message.id;
			clearTimeout( timersRef.current.get( id ) );
			timersRef.current.set(
				id,
				setTimeout( () => {
					timersRef.current.delete( id );
					setLeaving( ( existing ) => existing.filter( ( e ) => e.message.id !== id ) );
				}, CARD_EXIT_MS )
			);
		}
	}, [ messages ] );

	useEffect( () => {
		const timers = timersRef.current;
		return () => {
			for ( const timer of timers.values() ) {
				clearTimeout( timer );
			}
			timers.clear();
		};
	}, [] );

	const rendered: RenderedMessage[] = messages.map( ( message ) => ( {
		message,
		leaving: false,
	} ) );
	// Splice departed cards back in at their remembered positions.
	for ( const entry of leaving ) {
		if ( ! rendered.some( ( item ) => item.message.id === entry.message.id ) ) {
			rendered.splice( Math.min( entry.index, rendered.length ), 0, {
				message: entry.message,
				leaving: true,
			} );
		}
	}
	return rendered;
}

// Persistent cards in the sidebar footer: condition-driven messages (app
// update ready, announcements, the getting-started checklist) that stay until
// acted on or dismissed. See data/queries/use-app-messages.ts for the sources.
export function AppMessageCards( { className }: { className?: string } ) {
	const { messages, dismiss } = useActivePersistentMessages();
	const rendered = useLeavingMessages( messages );

	if ( ! rendered.length ) {
		return null;
	}

	return (
		<div className={ clsx( styles.stack, className ) }>
			{ rendered.map( ( { message, leaving } ) => (
				<div key={ message.id } className={ styles.cell } data-leaving={ leaving ? '' : undefined }>
					{ message.kind === 'checklist' ? (
						<GettingStartedCard message={ message } onDismiss={ () => dismiss( message ) } />
					) : (
						<Notice.Root
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
					) }
				</div>
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
