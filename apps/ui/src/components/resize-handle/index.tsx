import { clsx } from 'clsx';
import styles from './style.module.css';
import type { KeyboardEventHandler, MouseEventHandler } from 'react';

interface ResizeHandleProps {
	className?: string;
	label: string;
	minWidth: number;
	maxWidth: number;
	width: number;
	isResizing: boolean;
	orientation?: 'vertical' | 'horizontal';
	onResizeStart: MouseEventHandler< HTMLDivElement >;
	onKeyDown: KeyboardEventHandler< HTMLDivElement >;
}

export function ResizeHandle( {
	className,
	label,
	minWidth,
	maxWidth,
	width,
	isResizing,
	orientation = 'vertical',
	onResizeStart,
	onKeyDown,
}: ResizeHandleProps ) {
	return (
		<div
			className={ clsx(
				styles.resizeHandle,
				orientation === 'horizontal' && styles.horizontal,
				className,
				isResizing && styles.resizing
			) }
			role="separator"
			aria-label={ label }
			aria-orientation={ orientation }
			aria-valuemin={ minWidth }
			aria-valuemax={ maxWidth }
			aria-valuenow={ width }
			tabIndex={ 0 }
			onMouseDown={ onResizeStart }
			onKeyDown={ onKeyDown }
		>
			<span className={ styles.resizeHandleIndicator } aria-hidden="true" />
		</div>
	);
}

export function ResizeOverlay( {
	className,
	orientation = 'vertical',
}: {
	className?: string;
	orientation?: 'vertical' | 'horizontal';
} ) {
	return (
		<div
			className={ clsx(
				styles.resizeOverlay,
				orientation === 'horizontal' && styles.horizontalOverlay,
				className
			) }
			aria-hidden="true"
		/>
	);
}
