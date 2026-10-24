import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Badge( {
	className,
	variant = 'default',
	size = 'default',
	...props
}: ComponentProps< 'span' > & {
	variant?: 'default' | 'accent' | 'on-accent' | 'secondary' | 'muted' | 'destructive';
	size?: 'default' | 'count' | 'xs' | 'icon';
} ) {
	return (
		<span
			data-slot="badge"
			data-variant={ variant }
			data-size={ size }
			className={ clsx( styles.badge, className ) }
			{ ...props }
		/>
	);
}
