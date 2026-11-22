import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { Button, Empty } from '@/lib/ui';
import styles from './style.module.css';

export function PanelLoadError( {
	message,
	onRetry,
	retrying = false,
	className,
}: {
	message: string;
	onRetry: () => void;
	retrying?: boolean;
	className?: string;
} ) {
	return (
		<Empty className={ clsx( styles.root, className ) } role="alert">
			<p className={ styles.message }>{ message }</p>
			<Button variant="outline" onClick={ onRetry } disabled={ retrying } aria-busy={ retrying }>
				{ __( 'Try again' ) }
			</Button>
		</Empty>
	);
}
