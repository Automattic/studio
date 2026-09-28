import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef } from 'react';

export const FLOATING_SURFACE_BACKGROUND = '#1e1e1e';

/** The surface menus and popovers float in; Base UI popups render through it. */
export const FloatingSurface = forwardRef< HTMLDivElement, ComponentPropsWithoutRef< 'div' > >(
	function FloatingSurface( { className, ...props }, ref ) {
		return <div ref={ ref } className={ clsx( styles.surface, className ) } { ...props } />;
	}
);
