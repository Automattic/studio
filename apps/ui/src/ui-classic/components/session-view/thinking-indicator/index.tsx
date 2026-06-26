import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import styles from './style.module.css';

export function ThinkingIndicator( {
	active,
	idleMessage,
	startedAt,
}: {
	active: boolean;
	idleMessage: string;
	startedAt: number | null;
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
			<div className={ styles.head }>
				<span className={ clsx( styles.dot, ! active && styles.dotIdle ) } aria-hidden="true" />
				<span className={ styles.label }>{ active ? message : idleMessage }</span>
				{ active && elapsedSeconds > 0 ? (
					<span className={ styles.elapsed }>{ `${ elapsedSeconds }s` }</span>
				) : null }
			</div>
		</div>
	);
}
