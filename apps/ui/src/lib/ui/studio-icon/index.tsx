import { clsx } from 'clsx';
import dark from './assets/studio-dark.svg';
import light from './assets/studio-light.svg';
import styles from './style.module.css';
export function StudioIcon( { className }: { className?: string } ) {
	return (
		<span className={ clsx( styles.icon, className ) } aria-hidden="true">
			<img src={ light } className={ styles.light } alt="" />
			<img src={ dark } className={ styles.dark } alt="" />
		</span>
	);
}
