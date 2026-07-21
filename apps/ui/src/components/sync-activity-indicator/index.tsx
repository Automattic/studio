import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import styles from './style.module.css';

export function SyncActivityIndicator( {
	className,
	decorative = false,
	label = __( 'Working…' ),
}: {
	className?: string;
	decorative?: boolean;
	label?: string;
} ) {
	return (
		<span
			className={ clsx( styles.root, className ) }
			role={ decorative ? undefined : 'status' }
			aria-label={ decorative ? undefined : label }
			aria-hidden={ decorative ? 'true' : undefined }
		>
			<span className={ styles.dot } />
			<span className={ styles.dot } />
			<span className={ styles.dot } />
		</span>
	);
}
