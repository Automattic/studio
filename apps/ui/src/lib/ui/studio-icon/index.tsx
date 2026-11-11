import { clsx } from 'clsx';
import light from './assets/studio-light.svg';
import styles from './style.module.css';
export function StudioIcon( { className }: { className?: string } ) {
	return (
		<span className={ clsx( styles.icon, className ) } data-color-scheme="light" aria-hidden="true">
			<img src={ light } alt="" />
		</span>
	);
}
