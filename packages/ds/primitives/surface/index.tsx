import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

/** The surface menus and popovers float on; Base UI popups render through it. */
export function FloatingSurface( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div
			className={ clsx( styles.floating, styles.popup, styles.motion, className ) }
			{ ...props }
		/>
	);
}
