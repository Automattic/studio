import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

type AlertVariant = 'default' | 'info' | 'success' | 'warning' | 'destructive';

/** A bordered message block; a leading svg child becomes its icon. */
export function Alert( {
	className,
	variant = 'default',
	...props
}: ComponentProps< 'div' > & { variant?: AlertVariant } ) {
	return (
		<div
			role="alert"
			data-slot="alert"
			data-variant={ variant }
			className={ clsx( styles.alert, className ) }
			{ ...props }
		/>
	);
}

export function AlertTitle( { className, ...props }: ComponentProps< 'div' > ) {
	return <div data-slot="alert-title" className={ clsx( styles.title, className ) } { ...props } />;
}

export function AlertDescription( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div
			data-slot="alert-description"
			className={ clsx( styles.description, className ) }
			{ ...props }
		/>
	);
}

export function AlertActions( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div data-slot="alert-actions" className={ clsx( styles.actions, className ) } { ...props } />
	);
}
