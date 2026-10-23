import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Spinner( {
	className,
	size = 'default',
	'aria-label': ariaLabel = __( 'Loading' ),
	...props
}: ComponentProps< 'svg' > & { size?: 'default' | 'xs' } ) {
	return (
		<svg
			data-slot="spinner"
			data-size={ size }
			role="status"
			aria-label={ ariaLabel }
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			className={ clsx( styles.spinner, className ) }
			{ ...props }
		>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	);
}
