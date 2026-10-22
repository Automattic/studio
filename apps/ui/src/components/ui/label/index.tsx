import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Label( { className, ...props }: ComponentProps< 'label' > ) {
	return <label data-slot="label" className={ clsx( styles.label, className ) } { ...props } />;
}
