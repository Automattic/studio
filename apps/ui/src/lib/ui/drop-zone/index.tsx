import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

export function DropZone( {
	icon,
	title,
	description,
	children,
	className,
	...props
}: Omit< ComponentProps< 'div' >, 'title' > & {
	icon?: ReactNode;
	title: ReactNode;
	description: ReactNode;
} ) {
	return (
		<div { ...props } className={ clsx( styles.zone, className ) }>
			{ icon ? <div className={ styles.icon }>{ icon }</div> : null }
			<div className={ styles.text }>
				<p className={ styles.label }>{ title }</p>
				<p className={ styles.help }>{ description }</p>
			</div>
			{ children }
		</div>
	);
}
