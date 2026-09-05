import { clsx } from 'clsx';
import styles from './cards.module.css';
import type { ReactNode } from 'react';

export function OverviewCard( { children }: { children: ReactNode } ) {
	return <section className={ styles.card }>{ children }</section>;
}

export function CardSection( {
	title,
	action,
	children,
}: {
	title?: string;
	action?: ReactNode;
	children: ReactNode;
} ) {
	return (
		<div className={ styles.cardSection }>
			{ ( title || action ) && (
				<div className={ clsx( styles.cardHeader, ! title && styles.cardHeaderActionOnly ) }>
					{ title && <h3 className={ styles.cardTitle }>{ title }</h3> }
					{ action }
				</div>
			) }
			{ children }
		</div>
	);
}

export function CardSectionDivider() {
	return <div className={ styles.sectionDivider } />;
}

export function CardEmptyState( { children }: { children: ReactNode } ) {
	return <p className={ styles.empty }>{ children }</p>;
}

export function CardRows( { children }: { children: ReactNode } ) {
	return <div className={ styles.rowList }>{ children }</div>;
}

export function RowDivider() {
	return <div className={ styles.rowDivider } />;
}
