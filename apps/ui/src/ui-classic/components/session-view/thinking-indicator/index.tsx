import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
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
						<AgentWorkingIndicator className={ styles.indicator } label={ null } ambient />
						<span className={ styles.label }>{ message }</span>
						{ elapsedSeconds > 0 ? (
							<span className={ styles.elapsed }>{ `${ elapsedSeconds }s` }</span>
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
