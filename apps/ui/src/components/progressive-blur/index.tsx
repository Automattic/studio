import { clsx } from 'clsx';
import styles from './style.module.css';

interface ProgressiveBlurProps {
	className?: string;
	direction?: 'top' | 'bottom';
	variant?: 'default' | 'extended';
}

export function ProgressiveBlur( {
	className,
	direction = 'top',
	variant = 'default',
}: ProgressiveBlurProps ) {
	return (
		<div
			className={ clsx(
				styles.root,
				direction === 'bottom' && styles.bottom,
				variant === 'extended' && styles.extended,
				className
			) }
			aria-hidden="true"
		>
			<span className={ clsx( styles.layer, styles.layerOne ) } />
			<span className={ clsx( styles.layer, styles.layerTwo ) } />
			<span className={ clsx( styles.layer, styles.layerThree ) } />
			<span className={ clsx( styles.layer, styles.layerFour ) } />
			<span className={ clsx( styles.layer, styles.layerFive ) } />
		</div>
	);
}
