import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { useEffect, useState } from 'react';
import styles from './style.module.css';

export function formatElapsedTime( elapsedSeconds: number ): string {
	const hours = Math.floor( elapsedSeconds / 3600 );
	const minutes = Math.floor( ( elapsedSeconds % 3600 ) / 60 );
	const seconds = elapsedSeconds % 60;

	return [
		hours > 0 ? `${ hours }h` : null,
		minutes > 0 ? `${ minutes }m` : null,
		seconds > 0 ? `${ seconds }s` : null,
	]
		.filter( ( part ): part is string => part !== null )
		.join( ' ' );
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
						{ elapsedSeconds > 0 ? (
							<span className={ styles.elapsed } dir="ltr">
								{ formatElapsedTime( elapsedSeconds ) }
							</span>
						) : null }
					</div>
					{ progressMessage ? (
						<span className={ styles.progress }>{ progressMessage }</span>
					) : null }
				</>
			) : null }
		</div>
	);
}
