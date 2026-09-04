import { Badge, Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './cards.module.css';
import { RowLink } from './row-link';
import type { ComponentProps, ReactNode } from 'react';

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

export function CardRowAction( { className, ...props }: ComponentProps< typeof Button > ) {
	return (
		<Button
			variant="minimal"
			tone="neutral"
			size="small"
			className={ clsx( styles.rowAction, className ) }
			{ ...props }
		/>
	);
}

export function CardRowBadge( { className, ...props }: ComponentProps< typeof Badge > ) {
	return <Badge className={ clsx( styles.rowBadge, className ) } { ...props } />;
}

export function CardResourceRow( {
	label,
	url,
	tooltip,
	meta,
	metaClassName,
	expired = false,
	actions,
	status,
}: {
	label: string;
	url: string;
	tooltip?: string;
	meta?: ReactNode;
	metaClassName?: string;
	expired?: boolean;
	actions: ReactNode;
	status?: ReactNode;
} ) {
	return (
		<div className={ styles.row }>
			<div className={ styles.rowLine }>
				{ expired ? (
					<span className={ clsx( styles.rowTitle, styles.rowTitleExpired ) } title={ url }>
						{ label }
					</span>
				) : (
					<RowLink label={ label } tooltip={ tooltip } url={ url } />
				) }
				{ meta ? <span className={ clsx( styles.rowMeta, metaClassName ) }>{ meta }</span> : null }
			</div>
			<div className={ styles.rowLine }>
				<div className={ styles.rowActions }>{ actions }</div>
				{ status }
			</div>
		</div>
	);
}
