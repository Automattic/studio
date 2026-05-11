import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentPropsWithoutRef } from 'react';

type ActionButtonProps = ComponentPropsWithoutRef< 'button' > & {
	fullWidth?: boolean;
};

export function ActionButton( {
	className,
	fullWidth = false,
	type = 'button',
	...props
}: ActionButtonProps ) {
	return (
		<button
			{ ...props }
			className={ clsx( styles.button, fullWidth && styles.fullWidth, className ) }
			type={ type }
		/>
	);
}
