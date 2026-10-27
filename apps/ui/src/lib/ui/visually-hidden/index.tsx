import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function VisuallyHidden( { className, ...props }: ComponentProps< 'span' > ) {
	return <span className={ clsx( styles.hidden, className ) } { ...props } />;
}
