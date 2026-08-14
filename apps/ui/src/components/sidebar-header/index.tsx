import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { menu, plus } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import styles from './style.module.css';
import type { CSSProperties, MouseEvent } from 'react';

export function SidebarHeader() {
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	// Windows/Linux pin the native window controls to a band at the top of the
	// window, so this header matches its height and the ☰/+ stay level with them.
	const windowControls = useWindowControlsOverlay();
	const navigate = useNavigate();
	const connector = useConnector();
	const handleOpenAppMenu = ( event: MouseEvent< HTMLButtonElement > ) => {
		const rect = event.currentTarget.getBoundingClientRect();
		void connector.popupAppMenu( { x: Math.round( rect.left ), y: Math.round( rect.bottom ) } );
	};
	return (
		<div
			className={ clsx(
				styles.root,
				! reserveTrafficLightSpace && styles.flush,
				windowControls && styles.windowControls
			) }
			style={
				windowControls
					? ( {
							'--sidebar-header-controls-height': `${ windowControls.height }px`,
					  } as CSSProperties )
					: undefined
			}
		>
			{ connector.showsAppMenuButton && (
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					className={ styles.menuButton }
					icon={ menu }
					label={ __( 'Menu' ) }
					onClick={ handleOpenAppMenu }
				/>
			) }
			<div className={ styles.actions }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ plus }
					label={ __( 'Add site' ) }
					onClick={ () => void navigate( { to: '/onboarding' } ) }
				/>
			</div>
		</div>
	);
}
