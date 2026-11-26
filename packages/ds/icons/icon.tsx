import { clsx } from 'clsx';
import styles from './icon.module.css';
import { ICON_SIZE } from './metrics';
import type { ComponentProps } from 'react';

export function Icon( { className, ...props }: ComponentProps< 'svg' > ) {
	return (
		<svg
			width={ ICON_SIZE }
			height={ ICON_SIZE }
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={ clsx( styles.icon, className ) }
			{ ...props }
		/>
	);
}
