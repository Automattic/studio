import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentProps, ElementRef } from 'react';

type Props = Omit< ComponentProps< typeof Button >, 'variant' | 'tone' | 'size' >;

/**
 * Thin wrapper around @wordpress/ui's `Button` for sidebar list rows.
 * Pins the minimal/neutral/small preset and neutralizes the primitive's
 * centering, min-width, border, and hover background so consumers only
 * need to supply their own dimensions, colors, and active state.
 *
 * Uses forwardRef so Base UI primitives (e.g. `Menu.Trigger`) can attach
 * their internal ref to the underlying button element.
 */
export const SidebarButton = forwardRef< ElementRef< typeof Button >, Props >(
	function SidebarButton( { className, render, nativeButton, ...props }, ref ) {
		return (
			<Button
				ref={ ref }
				variant="minimal"
				tone="neutral"
				size="small"
				className={ clsx( styles.root, className ) }
				render={ render }
				// A `render` prop replaces the native <button>; opt out of Base UI's
				// native-button semantics unless the caller explicitly opts back in.
				nativeButton={ nativeButton ?? ! render }
				{ ...props }
			/>
		);
	}
);
