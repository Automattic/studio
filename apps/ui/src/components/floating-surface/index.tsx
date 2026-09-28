import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef } from 'react';

/**
 * The chrome every menu and popover floats in: a fixed dark surface, border,
 * radius, elevation, and the open/close motion. Base UI popups render through
 * it with their `render` prop, so the positioner's data attributes drive the motion.
 */
export const FloatingSurface = forwardRef< HTMLDivElement, ComponentPropsWithoutRef< 'div' > >(
	function FloatingSurface( { className, ...props }, ref ) {
		return <div ref={ ref } className={ clsx( styles.surface, className ) } { ...props } />;
	}
);
