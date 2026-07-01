import { clsx } from 'clsx';
import styles from './style.module.css';

interface ProgressiveBlurProps {
	direction: 'down' | 'up';
	className?: string;
	fadeToSurface?: boolean;
}

export function ProgressiveBlur( {
	direction,
	className,
	fadeToSurface = false,
}: ProgressiveBlurProps ) {
	return (
		<div className={ clsx( styles.root, styles[ direction ], className ) } aria-hidden="true">
			<span className={ clsx( styles.layer, styles.layerSoft ) } />
			<span className={ clsx( styles.layer, styles.layerMedium ) } />
			<span className={ clsx( styles.layer, styles.layerStrong ) } />
			<span className={ clsx( styles.layer, styles.layerIntense ) } />
			{ fadeToSurface ? <span className={ styles.surfaceFade } /> : null }
		</div>
	);
}
