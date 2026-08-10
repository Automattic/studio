import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { menu, plus } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import styles from './style.module.css';
import type { MouseEvent } from 'react';

export function SidebarHeader() {
	const reserveTrafficLightSpace = useTrafficLightSpace().start;
	const navigate = useNavigate();
	const connector = useConnector();
	const handleOpenAppMenu = ( event: MouseEvent< HTMLButtonElement > ) => {
		const rect = event.currentTarget.getBoundingClientRect();
		void connector.popupAppMenu( { x: Math.round( rect.left ), y: Math.round( rect.bottom ) } );
	};
	return (
		<div className={ `${ styles.root } ${ reserveTrafficLightSpace ? '' : styles.flush }` }>
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
