import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef } from 'react';
import styles from './style.module.css';
import type { ComponentProps, ElementRef } from 'react';

type ActionButtonVariant = 'filled' | 'ghost';
type ActionButtonSize = 'default' | 'large';

type ActionButtonProps = Omit< ComponentProps< typeof Button >, 'variant' | 'tone' | 'size' > & {
	fullWidth?: boolean;
	size?: ActionButtonSize;
	variant?: ActionButtonVariant;
};

export const ActionButton = forwardRef< ElementRef< typeof Button >, ActionButtonProps >(
	function ActionButton(
		{
			className,
			fullWidth = false,
			nativeButton,
			render,
			size = 'default',
			type = 'button',
			variant = 'filled',
			...props
		},
		ref
	) {
		return (
			<Button
				ref={ ref }
				variant="unstyled"
				tone="neutral"
				size="small"
				className={ clsx(
					styles.button,
					styles[ variant ],
					size === 'large' && styles.large,
					fullWidth && styles.fullWidth,
					className
				) }
				nativeButton={ nativeButton ?? ! render }
				render={ render }
				type={ type }
				{ ...props }
			/>
		);
	}
);
