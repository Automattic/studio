import { useEffect, useState } from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import { formatElapsedTime, RollingChar } from '@/components/rolling-text';
import styles from './style.module.css';

function ElapsedTime( { seconds }: { seconds: number } ) {
	const text = formatElapsedTime( seconds );
	return (
		<span className={ styles.elapsed } aria-hidden="true">
			{ text
				.split( '' )
				.map( ( char, index ) =>
					char === ' ' ? (
						<span key={ text.length - index }>&nbsp;</span>
					) : (
						<RollingChar key={ text.length - index } char={ char } />
					)
				) }
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
	const [ elapsedSeconds, setElapsedSeconds ] = useState( 0 );

	useEffect( () => {
		if ( ! active || startedAt === null ) {
			return;
		}
		setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		const tickInterval = window.setInterval( () => {
			setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		}, 1000 );
		return () => {
			window.clearInterval( tickInterval );
		};
	}, [ active, startedAt ] );

	return (
		<div className={ styles.root }>
			{ active ? (
				<>
					<div className={ styles.head }>
						<AgentWorkingIndicator className={ styles.pixels } />
						{ elapsedSeconds > 0 ? <ElapsedTime seconds={ elapsedSeconds } /> : null }
					</div>
					{ progressMessage ? (
						<span className={ styles.progress }>{ progressMessage }</span>
					) : null }
				</>
			) : null }
		</div>
	);
}

export { formatElapsedTime } from '@/components/rolling-text';
