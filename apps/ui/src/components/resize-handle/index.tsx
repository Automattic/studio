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
	onResizeStart,
	onKeyDown,
}: ResizeHandleProps ) {
	return (
		<div
			className={ clsx( styles.resizeHandle, className, isResizing && styles.resizing ) }
			role="separator"
			aria-label={ label }
			aria-orientation="vertical"
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

export function ResizeOverlay( { className }: { className?: string } ) {
	return <div className={ clsx( styles.resizeOverlay, className ) } aria-hidden="true" />;
}
