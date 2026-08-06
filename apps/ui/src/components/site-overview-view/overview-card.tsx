import styles from './cards.module.css';
import type { ReactNode } from 'react';

/**
 * The overview's summary card: one surface, divided into sections. Cards state
 * what's true about the site; the button sections beside them are where you act
 * on it.
 */
export function OverviewCard( { children }: { children: ReactNode } ) {
	return <section className={ styles.card }>{ children }</section>;
}

/** A titled band inside the card — About, Connections, Preview sites. */
export function CardSection( {
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
} ) {
	return (
		<div className={ styles.cardSection }>
			<div className={ styles.cardHeader }>
				<h2 className={ styles.cardTitle }>{ title }</h2>
				{ action }
			</div>
			{ children }
		</div>
	);
}

/** Full-bleed rule between sections, so the card reads as one surface. */
export function CardSectionDivider() {
	return <div className={ styles.sectionDivider } />;
}

export function CardEmptyState( { children }: { children: ReactNode } ) {
	return <p className={ styles.empty }>{ children }</p>;
}

/** The rows inside a section; dividers sit between them as siblings. */
export function CardRows( { children }: { children: ReactNode } ) {
	return <div className={ styles.rowList }>{ children }</div>;
}

export function RowDivider() {
	return <div className={ styles.rowDivider } />;
}
