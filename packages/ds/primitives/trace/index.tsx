import { Collapsible } from '@base-ui/react/collapsible';
import { clsx } from 'clsx';
import { ChevronDownIcon } from '../../icons';
import { Button } from '../button';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Trace( { className, ...props }: ComponentProps< 'div' > ) {
	return <div className={ clsx( styles.root, className ) } data-slot="trace" { ...props } />;
}

export function TraceLine( {
	className,
	status,
	...props
}: ComponentProps< 'span' > & { status?: 'running' | 'pending' | 'error' } ) {
	return <span className={ clsx( styles.line, className ) } data-status={ status } { ...props } />;
}

export function TraceIcon( { className, ...props }: ComponentProps< 'span' > ) {
	return <span className={ clsx( styles.icon, className ) } aria-hidden="true" { ...props } />;
}

export function TraceTitle( { className, ...props }: ComponentProps< 'span' > ) {
	return <span className={ clsx( styles.title, className ) } { ...props } />;
}

export function TraceDetails( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div className={ clsx( styles.details, className ) } data-slot="trace-details" { ...props } />
	);
}

export function TraceButton( { className, children, ...props }: ComponentProps< typeof Button > ) {
	return (
		<Button
			variant="inline-text"
			size="inline"
			data-toggle-highlight={ false }
			className={ clsx( styles.trigger, className ) }
			{ ...props }
		>
			{ children }
			<ChevronDownIcon
				className={ styles.chevron }
				data-icon="inline-end"
				data-dropdown-indicator
			/>
		</Button>
	);
}

export function TraceCollapsible( {
	className,
	...props
}: ComponentProps< typeof Collapsible.Root > ) {
	return <Collapsible.Root className={ clsx( styles.collapsible, className ) } { ...props } />;
}

export function TraceCollapsibleTrigger( props: ComponentProps< typeof Collapsible.Trigger > ) {
	return <Collapsible.Trigger render={ <TraceButton /> } { ...props } />;
}

export function TraceCollapsibleContent( {
	className,
	children,
	...props
}: ComponentProps< typeof Collapsible.Panel > ) {
	return (
		<Collapsible.Panel className={ clsx( styles.content, className ) } { ...props }>
			<TraceDetails>{ children }</TraceDetails>
		</Collapsible.Panel>
	);
}
