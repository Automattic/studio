import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** A pulsing placeholder for content that is still loading. */
export function Skeleton( { className, ...props }: ComponentProps< 'span' > ) {
	return (
		<span data-slot="skeleton" className={ clsx( styles.skeleton, className ) } { ...props } />
	);
}
