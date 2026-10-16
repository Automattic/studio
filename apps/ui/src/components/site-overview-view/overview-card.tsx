import { CopyButton } from '@/components/copy-button';
import styles from './cards.module.css';
import type { ReactNode } from 'react';

export function OverviewCard( { children }: { children: ReactNode } ) {
	return <div className={ styles.card }>{ children }</div>;
}

export function CardSection( { children }: { children: ReactNode } ) {
	return <section className={ styles.cardSection }>{ children }</section>;
}

export function CopyableRow( {
	label,
	displayValue,
	copyText,
	copyLabel,
}: {
	label: string;
	displayValue: string;
	copyText: string;
	copyLabel: string;
} ) {
	return (
		<div className={ styles.copyableRow }>
			<span className={ styles.tileLabel }>{ label }</span>
			<div className={ styles.copyableValue }>
				<span className={ styles.copyableText } title={ displayValue }>
					{ displayValue }
				</span>
				<CopyButton text={ copyText } label={ copyLabel } />
			</div>
		</div>
	);
}
