import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
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
						<span className={ styles.dot } aria-hidden="true" />
						<span className={ styles.label }>{ message }</span>
						{ elapsedSeconds > 0 ? (
							<span className={ styles.elapsed }>
								{ sprintf(
									/* translators: %d is the number of elapsed seconds, e.g. "5s". */
									__( '%ds' ),
									elapsedSeconds
								) }
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
