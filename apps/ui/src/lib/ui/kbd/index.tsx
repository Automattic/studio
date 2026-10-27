import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

export function Kbd( {
	className,
	variant = 'default',
	...props
}: ComponentProps< 'kbd' > & { variant?: 'default' | 'outline' | 'settings' } ) {
	return (
		<kbd
			data-slot="kbd"
			data-variant={ variant }
			className={ clsx( styles.kbd, className ) }
			{ ...props }
		/>
	);
}

export function KbdGroup( { className, ...props }: ComponentProps< 'kbd' > ) {
	return <kbd data-slot="kbd-group" className={ clsx( styles.group, className ) } { ...props } />;
}
