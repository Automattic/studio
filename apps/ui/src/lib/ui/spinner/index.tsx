import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Spinner( {
	className,
	'aria-label': ariaLabel = __( 'Loading' ),
	...props
}: ComponentProps< 'svg' > ) {
	return (
		<svg
			data-slot="spinner"
			// Keeps the `svg:not( [data-size] )` icon sizing in buttons and inputs off it.
			data-size="default"
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
