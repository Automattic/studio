import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { VisuallyHidden } from '@wordpress/components';
import { useEffect, useState } from 'react';
import styles from './style.module.css';

type ElapsedTimePart = {
	unit: 'h' | 'm' | 's';
	value: number;
};

export function getElapsedTimeParts( elapsedSeconds: number ): ElapsedTimePart[] {
	const hours = Math.floor( elapsedSeconds / 3600 );
	const minutes = Math.floor( ( elapsedSeconds % 3600 ) / 60 );
	const seconds = elapsedSeconds % 60;

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
			<VisuallyHidden as="span">{ label }</VisuallyHidden>
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
		if ( ! active || startedAt === null ) {
			return;
		}
		setMessage( randomThinkingMessage() );
		setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		const labelInterval = window.setInterval( () => {
			setMessage( randomThinkingMessage() );
		}, 4000 );
		const tickInterval = window.setInterval( () => {
			setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		}, 1000 );
		return () => {
			window.clearInterval( labelInterval );
			window.clearInterval( tickInterval );
		};
	}, [ active, startedAt ] );

	return (
		<div className={ styles.root } role="status" aria-live="polite">
			{ active ? (
				<>
					<div className={ styles.head }>
						<span className={ styles.dot } aria-hidden="true" />
						<span className={ styles.label }>{ message }</span>
						<AnimatedElapsedTime elapsedSeconds={ elapsedSeconds } />
					</div>
					{ progressMessage ? (
						<span className={ styles.progress }>{ progressMessage }</span>
					) : null }
				</>
			) : null }
		</div>
	);
}
