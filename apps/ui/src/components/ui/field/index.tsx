import { clsx } from 'clsx';
import { Label } from '@/components/ui/label';
import styles from './style.module.css';
import type { ComponentProps, ReactNode } from 'react';

export function FieldSet( { className, ...props }: ComponentProps< 'fieldset' > ) {
	return (
		<fieldset data-slot="field-set" className={ clsx( styles.set, className ) } { ...props } />
	);
}

export function FieldLegend( {
	className,
	variant = 'legend',
	...props
}: ComponentProps< 'legend' > & { variant?: 'legend' | 'label' | 'hidden' } ) {
	return (
		<legend
			data-slot="field-legend"
			data-variant={ variant }
			className={ clsx( styles.legend, className ) }
			{ ...props }
		/>
	);
}

export function FieldGroup( {
	variant = 'default',
	className,
	...props
}: ComponentProps< 'div' > & { variant?: 'default' | 'settings' | 'sections' | 'inset' } ) {
	return (
		<div
			data-slot="field-group"
			data-variant={ variant }
			className={ clsx( styles.group, className ) }
			{ ...props }
		/>
	);
}

export function Field( {
	className,
	orientation = 'vertical',
	...props
}: ComponentProps< 'div' > & { orientation?: 'vertical' | 'horizontal' } ) {
	return (
		<div
			role="group"
			data-slot="field"
			data-orientation={ orientation }
			className={ clsx( styles.field, className ) }
			{ ...props }
		/>
	);
}

export function FieldContent( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div data-slot="field-content" className={ clsx( styles.content, className ) } { ...props } />
	);
}

export function FieldLabel( {
	className,
	tone = 'default',
	...props
}: ComponentProps< typeof Label > & { tone?: 'default' | 'muted' } ) {
	return (
		<Label
			data-slot="field-label"
			data-tone={ tone }
			className={ clsx( styles.title, styles.label, className ) }
			{ ...props }
		/>
	);
}

export function FieldTitle( { className, ...props }: ComponentProps< 'div' > ) {
	return <div data-slot="field-label" className={ clsx( styles.title, className ) } { ...props } />;
}

export function FieldDescription( {
	className,
	width = 'default',
	error,
	children,
	...props
}: ComponentProps< 'p' > & { width?: 'default' | 'full'; error?: ReactNode } ) {
	return (
		<p
			data-slot="field-description"
			data-width={ width }
			data-error={ error ? true : undefined }
			className={ clsx( styles.description, className ) }
			{ ...props }
		>
			{ error ? (
				<>
					<span aria-hidden="true" className={ styles.reserved }>
						{ children }
					</span>
					<span role="alert" className={ styles.reserved }>
						{ error }
					</span>
				</>
			) : (
				children
			) }
		</p>
	);
}

export function FieldError( { className, ...props }: ComponentProps< 'div' > ) {
	if ( ! props.children ) {
		return null;
	}
	return (
		<div
			role="alert"
			data-slot="field-error"
			className={ clsx( styles.error, className ) }
			{ ...props }
		/>
	);
}
