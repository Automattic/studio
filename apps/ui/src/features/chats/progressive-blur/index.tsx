import { clsx } from 'clsx';
import styles from './style.module.css';

interface ProgressiveBlurProps {
	className?: string;
}

export function ProgressiveBlur( { className }: ProgressiveBlurProps ) {
	return (
		<div className={ clsx( styles.root, className ) } aria-hidden="true">
			<span className={ clsx( styles.layer, styles.layerSoft ) } />
			<span className={ clsx( styles.layer, styles.layerMedium ) } />
			<span className={ clsx( styles.layer, styles.layerStrong ) } />
			<span className={ clsx( styles.layer, styles.layerIntense ) } />
			<span className={ styles.surfaceFade } />
		</div>
	);
}
