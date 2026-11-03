import { clsx } from 'clsx';
import styles from './style.module.css';
import type { CSSProperties } from 'react';

/**
 * A note's number on the part it is about. The view that draws it places it
 * with `className` or `style`.
 */
export function AnnotationMarker( {
	number,
	className,
	style,
}: {
	number: number;
	className?: string;
	style?: CSSProperties;
} ) {
	return (
		<span className={ clsx( styles.marker, className ) } style={ style } aria-hidden="true">
			{ number }
		</span>
	);
}
