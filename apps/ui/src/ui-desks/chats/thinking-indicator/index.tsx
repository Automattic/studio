import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { useEffect, useRef, useState } from 'react';
import styles from './style.module.css';

export function ThinkingIndicator( {
	active,
	startedAt,
	messageKey,
	progressMessage,
}: {
	active: boolean;
	startedAt: number | null;
	messageKey?: string | null;
	progressMessage: string | null;
} ) {
	const rotationKey = active && startedAt !== null ? `${ startedAt }:${ messageKey ?? '' }` : null;
	const [ message, setMessage ] = useState( () =>
		rotationKey === null ? '' : randomThinkingMessage()
	);
	const [ elapsedSeconds, setElapsedSeconds ] = useState( 0 );
	const previousRotationKey = useRef( rotationKey );

	useEffect( () => {
		if ( rotationKey === null || startedAt === null ) {
			previousRotationKey.current = rotationKey;
			setElapsedSeconds( 0 );
			return;
		}
		if ( previousRotationKey.current !== rotationKey ) {
			previousRotationKey.current = rotationKey;
			setMessage( randomThinkingMessage() );
		}
		setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		const tickInterval = window.setInterval( () => {
			setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		}, 1000 );
		return () => {
			window.clearInterval( tickInterval );
		};
	}, [ rotationKey, startedAt ] );

	return (
		<div className={ styles.root } role="status" aria-live="polite">
			{ active ? (
				<>
					<div className={ styles.head }>
						<span className={ styles.dot } aria-hidden="true" />
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
