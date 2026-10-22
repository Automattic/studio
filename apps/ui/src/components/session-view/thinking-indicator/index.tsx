import { useEffect, useState } from 'react';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import styles from './style.module.css';

type ElapsedTimePart = {
	unit: 'h' | 'm' | 's';
	value: number;
};

function getElapsedTimeParts( elapsedSeconds: number ): ElapsedTimePart[] {
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

export function AnimatedElapsedTime( { elapsedSeconds }: { elapsedSeconds: number } ) {
	const parts = getElapsedTimeParts( elapsedSeconds );
	const label = formatElapsedTime( elapsedSeconds );

	return (
		<span className={ styles.elapsed } dir="ltr">
			<VisuallyHidden aria-live="off">{ label }</VisuallyHidden>
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
