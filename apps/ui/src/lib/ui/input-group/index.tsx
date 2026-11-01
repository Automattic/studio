import { clsx } from 'clsx';
import { Input } from '@/lib/ui/input';
import { Textarea } from '@/lib/ui/textarea';
import styles from './style.module.css';
import type { ComponentProps, MouseEvent } from 'react';

/** A bordered row that holds an input with leading or trailing addons. */
export function InputGroup( {
	className,
	variant = 'default',
	...props
}: ComponentProps< 'div' > & { variant?: 'default' | 'composer' | 'commands' } ) {
	return (
		<div
			role="group"
			data-slot="input-group"
			data-variant={ variant }
			className={ clsx( styles.group, className ) }
			{ ...props }
		/>
	);
}

function focusControl( event: MouseEvent< HTMLDivElement > ) {
	const target = event.target as HTMLElement;
	if ( ! event.currentTarget.contains( target ) || target.closest( 'button' ) ) {
		return;
	}
	const control = event.currentTarget.parentElement?.querySelector<
		HTMLInputElement | HTMLTextAreaElement
	>( 'input, textarea' );
	if ( control ) {
		control.dataset.pointerFocus = '';
		control.focus();
	}
}

export function InputGroupAddon( {
	className,
	align = 'inline-start',
	onClick,
	...props
}: ComponentProps< 'div' > & {
	align?: 'inline-start' | 'inline-end';
} ) {
	return (
		<div
			role="group"
			data-slot="input-group-addon"
			data-align={ align }
			className={ clsx( styles.addon, className ) }
			onClick={ ( event ) => {
				focusControl( event );
				onClick?.( event );
			} }
			{ ...props }
		/>
	);
}

export function InputGroupInput( { className, ...props }: ComponentProps< typeof Input > ) {
	return (
		<Input
			variant="group"
			data-slot="input-group-control"
			className={ clsx( styles.control, className ) }
			{ ...props }
		/>
	);
}

export function InputGroupTextarea( { className, ...props }: ComponentProps< typeof Textarea > ) {
	return (
		<Textarea
			variant="group"
			data-slot="input-group-control"
			className={ clsx( styles.control, className ) }
			{ ...props }
		/>
	);
}
