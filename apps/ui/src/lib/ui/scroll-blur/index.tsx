import { clsx } from 'clsx';
import styles from './style.module.css';

/** Keep this beside the scrolling content, below its fixed controls. */
export function ScrollBlur( { edge, className }: { edge: 'top' | 'bottom'; className?: string } ) {
	return (
		<div aria-hidden="true" data-scroll-blur={ edge } className={ clsx( styles.root, className ) }>
			<span className={ styles.soft } />
			<span className={ styles.medium } />
			<span className={ styles.strong } />
		</div>
	);
}
