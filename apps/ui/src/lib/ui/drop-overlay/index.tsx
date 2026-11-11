import { clsx } from 'clsx';
import { Button } from '@/lib/ui/button';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function DropOverlay( { children, className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div { ...props } className={ clsx( styles.dropOverlay, className ) } aria-hidden="true">
			<Button variant="accent" tabIndex={ -1 }>
				{ children }
			</Button>
		</div>
	);
}
