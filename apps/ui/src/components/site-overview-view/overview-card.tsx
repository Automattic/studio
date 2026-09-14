import styles from './cards.module.css';
import type { ReactNode } from 'react';

export function OverviewCard( { children }: { children: ReactNode } ) {
	return <div className={ styles.card }>{ children }</div>;
}

export function CardSection( { children }: { children: ReactNode } ) {
	return <section className={ styles.cardSection }>{ children }</section>;
}
