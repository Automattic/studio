import { Progress as BaseProgress } from '@base-ui/react/progress';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** `intent` escalates the bar's color as a limit nears: warning, then critical, then exhausted. */
export function Progress( {
	className,
	children,
	intent,
	...props
}: ComponentProps< typeof BaseProgress.Root > & {
	intent?: 'warning' | 'critical' | 'exhausted';
} ) {
	return (
		<BaseProgress.Root
			data-slot="progress"
			data-intent={ intent }
			className={ clsx( styles.root, className ) }
			{ ...props }
		>
			{ children }
			<BaseProgress.Track data-slot="progress-track" className={ styles.track }>
				<BaseProgress.Indicator data-slot="progress-indicator" className={ styles.indicator } />
			</BaseProgress.Track>
		</BaseProgress.Root>
	);
}
