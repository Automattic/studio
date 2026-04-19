import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

type Props = Omit< ComponentProps< typeof Button >, 'variant' | 'tone' | 'size' >;

/**
 * Thin wrapper around @wordpress/ui's `Button` for sidebar list rows.
 * Pins the minimal/neutral/small preset and neutralizes the primitive's
 * centering, min-width, border, and hover background so consumers only
 * need to supply their own dimensions, colors, and active state.
 */
export function SidebarButton( { className, ...props }: Props ) {
	return (
		<Button
			variant="minimal"
			tone="neutral"
			size="small"
			className={ clsx( styles.root, className ) }
			{ ...props }
		/>
	);
}
