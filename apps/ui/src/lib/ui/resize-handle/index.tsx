import { clsx } from 'clsx';
import styles from './style.module.css';
import type { KeyboardEventHandler, MouseEventHandler } from 'react';

interface ResizeHandleProps {
	className?: string;
	label: string;
	minWidth: number;
	maxWidth: number;
	width: number;
	onResizeStart: MouseEventHandler< HTMLDivElement >;
	onKeyDown: KeyboardEventHandler< HTMLDivElement >;
	onDoublePress?: () => void;
}

export function ResizeHandle( {
	className,
	label,
	minWidth,
	maxWidth,
	width,
	onResizeStart,
	onKeyDown,
	onDoublePress,
}: ResizeHandleProps ) {
	return (
		<div
			className={ clsx( styles.resizeHandle, className ) }
			role="separator"
			aria-label={ label }
			aria-orientation="vertical"
			aria-valuemin={ minWidth }
			aria-valuemax={ maxWidth }
			aria-valuenow={ width }
			tabIndex={ 0 }
			// A drag covers the handle with ResizeOverlay, so a double-click never
			// reaches it as `dblclick`. Handle the second press instead.
			onMouseDown={ ( event ) => {
				if ( onDoublePress && event.button === 0 && event.detail === 2 ) {
					event.preventDefault();
					onDoublePress();
				} else {
					onResizeStart( event );
				}
			} }
			onKeyDown={ onKeyDown }
		/>
	);
}

export function ResizeOverlay( { className }: { className?: string } ) {
	return <div className={ clsx( styles.resizeOverlay, className ) } aria-hidden="true" />;
}
