import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ReactNode } from 'react';

export function SettingsCard( {
	title,
	description,
	actions,
	children,
	className,
}: {
	title: string;
	description?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
	className?: string;
} ) {
	return (
		<section className={ clsx( styles.card, className ) }>
			<div className={ styles.cardHeader }>
				<div className={ styles.cardHeaderText }>
					<h2 className={ styles.cardTitle }>{ title }</h2>
					{ description ? <p className={ styles.cardDescription }>{ description }</p> : null }
				</div>
				{ actions ? <div className={ styles.cardHeaderActions }>{ actions }</div> : null }
			</div>
			{ children }
		</section>
	);
}
