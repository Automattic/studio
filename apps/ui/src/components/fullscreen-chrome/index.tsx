import { __ } from '@wordpress/i18n';
import { close } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { useWindowControlsSurface } from '@/hooks/use-window-controls-surface';
import styles from './style.module.css';

interface FullscreenChromeProps {
	/**
	 * When provided, renders a close button in the top-right corner so the user
	 * can leave the fullscreen view. Omit to render just the window drag edges.
	 */
	onClose?: () => void;
	/** Accessible label for the close button. Defaults to "Close". */
	closeLabel?: string;
	/** Disables the close button, e.g. while a submit is in flight. */
	closeDisabled?: boolean;
}

/**
 * Window chrome for fullscreen views that fill the window with no native title
 * bar (site creation, settings). Renders invisible drag strips along the top,
 * left, and bottom edges so the window can still be moved, plus an optional
 * close button pinned top-right. The right edge is left free for a scroll bar,
 * and the close button stays clickable over the drag strips via the global
 * no-drag rule in index.css.
 */
export function FullscreenChrome( { onClose, closeLabel, closeDisabled }: FullscreenChromeProps ) {
	const closeAtStart = useWindowControlsOverlay() !== null;
	// This view covers the window chrome the controls normally sit on.
	useWindowControlsSurface( 'content' );
	return (
		<>
			<div aria-hidden="true">
				<div className={ `${ styles.dragEdge } ${ styles.dragEdgeTop }` } />
				<div className={ `${ styles.dragEdge } ${ styles.dragEdgeLeft }` } />
				<div className={ `${ styles.dragEdge } ${ styles.dragEdgeBottom }` } />
			</div>
			{ onClose && (
				<IconButton
					className={ clsx( styles.close, closeAtStart && styles.closeWindowControls ) }
					variant="minimal"
					tone="neutral"
					size="default"
					icon={ close }
					label={ closeLabel ?? __( 'Close' ) }
					onClick={ onClose }
					disabled={ closeDisabled }
				/>
			) }
		</>
	);
}
