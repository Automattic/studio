import { Spinner } from '@wordpress/components';
import { Badge, Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './cards.module.css';
import { RowLink } from './row-link';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

export function OverviewCard( { children, ...props }: ComponentProps< 'section' > ) {
	return (
		<section className={ styles.card } { ...props }>
			{ children }
		</section>
	);
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

export function CardSectionFooter( { children }: { children: ReactNode } ) {
	return <div className={ styles.sectionFooter }>{ children }</div>;
}

export function CardEmptyState( { children }: { children: ReactNode } ) {
	if ( typeof children !== 'string' ) {
		return <p className={ styles.empty }>{ children }</p>;
	}

	const orphanSafeText = children.replace( /(\S+)\s+(\S+)\s*$/, '$1\u00a0$2' );
	return <p className={ styles.empty }>{ orphanSafeText }</p>;
}

export function CardLoadingState( { label }: { label: string } ) {
	return (
		<div className={ styles.loadingState } role="status" aria-label={ label }>
			<Spinner />
			<span>{ label }</span>
		</div>
	);
}

export function CardRows( { children }: { children: ReactNode } ) {
	return <div className={ styles.rowList }>{ children }</div>;
}

export function RowDivider() {
	return <div className={ styles.rowDivider } />;
}

export function ButtonTooltip( {
	tooltip,
	children,
}: {
	tooltip: string;
	children: ReactElement;
} ) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={ <span className={ styles.buttonTooltipTrigger }>{ children }</span> }
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ tooltip }</Tooltip.Popup>
		</Tooltip.Root>
	);
}

export function CardHeaderAction( {
	tooltip,
	className,
	...props
}: ComponentProps< typeof Button > & { tooltip: string } ) {
	return (
		<ButtonTooltip tooltip={ tooltip }>
			<Button
				variant="minimal"
				tone="neutral"
				size="small"
				className={ clsx( styles.headerAction, className ) }
				{ ...props }
			/>
		</ButtonTooltip>
	);
}

export function CardRowAction( {
	tooltip,
	className,
	...props
}: ComponentProps< typeof Button > & { tooltip: string } ) {
	return (
		<ButtonTooltip tooltip={ tooltip }>
			<Button
				variant="minimal"
				tone="neutral"
				size="small"
				className={ clsx( styles.rowAction, className ) }
				{ ...props }
			/>
		</ButtonTooltip>
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
	url?: string;
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
				{ ! url ? (
					<span className={ styles.rowTitle }>{ label }</span>
				) : expired ? (
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
