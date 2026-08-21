import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import styles from './style.module.css';

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
					<span className={ styles.elapsed }>{ `${ elapsedSeconds }s` }</span>
				</div>
				{ progressMessage ? <span className={ styles.progress }>{ progressMessage }</span> : null }
			</div>
		</div>
	);
}
