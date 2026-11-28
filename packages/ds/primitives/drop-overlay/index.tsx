import { clsx } from 'clsx';
import { Button } from '../button';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function DropOverlay( {
	children,
	className,
	variant = 'default',
	...props
}: ComponentProps< 'div' > & { variant?: 'default' | 'panel' } ) {
	return (
		<div
			{ ...props }
			className={ clsx( styles.dropOverlay, variant === 'panel' && styles.panel, className ) }
			data-variant={ variant }
			aria-hidden="true"
		>
			<Button
				variant={ variant === 'panel' ? 'secondary' : 'accent' }
				className={ variant === 'panel' ? styles.panelLabel : undefined }
				tabIndex={ -1 }
			>
				{ children }
			</Button>
		</div>
	);
}
