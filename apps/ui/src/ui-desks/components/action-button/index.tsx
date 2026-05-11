import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentProps, ElementRef } from 'react';

type ActionButtonProps = Omit< ComponentProps< typeof Button >, 'variant' | 'tone' | 'size' > & {
	fullWidth?: boolean;
};

export const ActionButton = forwardRef< ElementRef< typeof Button >, ActionButtonProps >(
	function ActionButton(
		{ className, fullWidth = false, nativeButton, render, type = 'button', ...props },
		ref
	) {
		return (
			<Button
				ref={ ref }
				variant="unstyled"
				tone="neutral"
				size="small"
				className={ clsx( styles.button, fullWidth && styles.fullWidth, className ) }
				nativeButton={ nativeButton ?? ! render }
				render={ render }
				type={ type }
				{ ...props }
			/>
		);
	}
);
