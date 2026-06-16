import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import styles from './style.module.css';

/**
 * Small WPDS loading spinner for inline use (list rows, labels). Sized to sit
 * in a line of text and themed with `--wpds-*` tokens. Pass a `label` for an
 * accessible status announcement.
 */
export function Spinner( {
	className,
	label = __( 'Loading' ),
}: {
	className?: string;
	label?: string;
} ) {
	return (
		<span className={ clsx( styles.spinner, className ) } role="status" aria-label={ label } />
	);
}
