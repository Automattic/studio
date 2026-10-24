import { Progress as BaseProgress } from '@base-ui/react/progress';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Progress( {
	className,
	children,
	...props
}: ComponentProps< typeof BaseProgress.Root > ) {
	return (
		<BaseProgress.Root
			data-slot="progress"
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
