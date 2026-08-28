import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { VisuallyHidden } from '@wordpress/components';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import styles from './style.module.css';

type ElapsedTimePart = {
	unit: 'h' | 'm' | 's';
	value: number;
};

export function getElapsedTimeParts( elapsedSeconds: number ): ElapsedTimePart[] {
	const totalSeconds = Math.max( 0, Math.floor( elapsedSeconds ) );
	const hours = Math.floor( totalSeconds / 3600 );
	const minutes = Math.floor( ( totalSeconds % 3600 ) / 60 );
	const seconds = totalSeconds % 60;

	return [
		hours > 0 ? { unit: 'h' as const, value: hours } : null,
		minutes > 0 ? { unit: 'm' as const, value: minutes } : null,
		{ unit: 's' as const, value: seconds },
	].filter( ( part ): part is ElapsedTimePart => part !== null );
}

export function formatElapsedTime( elapsedSeconds: number ): string {
	return getElapsedTimeParts( elapsedSeconds )
		.map( ( { unit, value } ) => `${ value }${ unit }` )
		.join( ' ' );
}

function AnimatedDigit( { digit }: { digit: string } ) {
	const [ displayedDigit, setDisplayedDigit ] = useState( digit );
	const changed = displayedDigit !== digit;

	useEffect( () => {
		if ( ! changed ) {
			return;
		}
		const timeout = window.setTimeout( () => setDisplayedDigit( digit ), 250 );
		return () => window.clearTimeout( timeout );
	}, [ changed, digit ] );

	return (
		<span className={ styles.digit }>
			{ changed ? (
				<span className={ styles.digitTransition } key={ `${ displayedDigit }-${ digit }` }>
					<span className={ styles.digitOutgoing }>{ displayedDigit }</span>
					<span className={ styles.digitIncoming }>{ digit }</span>
				</span>
			) : (
				<span>{ digit }</span>
			) }
		</span>
	);
}

function AnimatedElapsedTime( { elapsedSeconds }: { elapsedSeconds: number } ) {
	const parts = getElapsedTimeParts( elapsedSeconds );
	const label = formatElapsedTime( elapsedSeconds );

	return (
		<span className={ styles.elapsed } dir="ltr">
			<VisuallyHidden as="span" aria-live="off">
				{ label }
			</VisuallyHidden>
			<span className={ styles.elapsedContent } aria-hidden="true">
				{ parts.map( ( { unit, value } ) => {
					const digits = String( value ).split( '' );
					return (
						<span className={ styles.timePart } key={ unit }>
							<span className={ styles.digits }>
								{ digits.map( ( digit, index ) => (
									<AnimatedDigit key={ digits.length - index - 1 } digit={ digit } />
								) ) }
							</span>
							<span>{ unit }</span>
						</span>
					);
				} ) }
			</span>
		</span>
	);
}

export function ThinkingIndicator( {
	active,
	startedAt,
	progressMessage,
}: {
	active: boolean;
	startedAt: number | null;
	progressMessage: string | null;
} ) {
	const [ message, setMessage ] = useState( () => randomThinkingMessage() );
	const [ elapsedSeconds, setElapsedSeconds ] = useState( 0 );

	useEffect( () => {
		if ( ! active ) {
			return;
		}
		setMessage( randomThinkingMessage() );
		const labelInterval = window.setInterval( () => {
			setMessage( randomThinkingMessage() );
		}, 4000 );
		return () => window.clearInterval( labelInterval );
	}, [ active ] );

	useEffect( () => {
		if ( ! active || startedAt === null ) {
			return;
		}
		const updateElapsed = () => {
			setElapsedSeconds( Math.max( 0, Math.floor( ( Date.now() - startedAt ) / 1000 ) ) );
		};
		updateElapsed();
		const tickInterval = window.setInterval( () => {
			updateElapsed();
		}, 1000 );
		return () => window.clearInterval( tickInterval );
	}, [ active, startedAt ] );

	return (
		<div
			className={ clsx( styles.root, active && styles.rootVisible ) }
			role="status"
			aria-live="polite"
			aria-hidden={ active ? undefined : 'true' }
		>
			<div className={ styles.content }>
				<div className={ styles.head }>
					<AgentWorkingIndicator className={ styles.indicator } label={ null } ambient />
					<span className={ styles.label }>{ message }</span>
					<AnimatedElapsedTime elapsedSeconds={ elapsedSeconds } />
				</div>
				{ progressMessage ? <span className={ styles.progress }>{ progressMessage }</span> : null }
			</div>
		</div>
	);
}
