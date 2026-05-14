import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import styles from './drop-action-menu.module.css';

export interface DropActionMenuAction {
	label: string;
	onClick: () => void;
}

interface DropActionMenuProps {
	screenPoint: {
		x: number;
		y: number;
	};
	actions: DropActionMenuAction[];
	onCancel: () => void;
}

const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 260;
const VIEWPORT_MARGIN = 8;

export function DropActionMenu( { screenPoint, actions, onCancel }: DropActionMenuProps ) {
	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' ) {
				onCancel();
			}
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ onCancel ] );

	return (
		<div
			className={ styles.backdrop }
			role="dialog"
			aria-modal="true"
			aria-label={ __( 'Drop actions' ) }
			onMouseDown={ onCancel }
		>
			<div
				className={ styles.menu }
				style={ getMenuPosition( screenPoint ) }
				role="menu"
				aria-label={ __( 'Drop actions' ) }
				onMouseDown={ ( event ) => event.stopPropagation() }
			>
				{ actions.map( ( action, index ) => (
					<button
						key={ action.label }
						type="button"
						className={ styles.item }
						role="menuitem"
						autoFocus={ index === 0 }
						onClick={ action.onClick }
					>
						{ action.label }
					</button>
				) ) }
				<div className={ styles.separator } role="separator" />
				<button type="button" className={ styles.item } role="menuitem" onClick={ onCancel }>
					{ __( 'Cancel' ) }
				</button>
			</div>
		</div>
	);
}

function getMenuPosition( point: DropActionMenuProps[ 'screenPoint' ] ) {
	if ( typeof window === 'undefined' ) {
		return {
			left: point.x,
			top: point.y,
		};
	}

	return {
		left: Math.max(
			VIEWPORT_MARGIN,
			Math.min( point.x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN )
		),
		top: Math.max(
			VIEWPORT_MARGIN,
			Math.min( point.y, window.innerHeight - MENU_MAX_HEIGHT - VIEWPORT_MARGIN )
		),
	};
}
