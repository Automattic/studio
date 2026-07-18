import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { menu, plugins, plus, wordpress } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import * as Menu from '@/components/menu';
import { QuickMenuItem } from '@/components/site-quick-menu';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import styles from './style.module.css';
import type { MouseEvent } from 'react';

export function SidebarHeader() {
	const reserveTrafficLightSpace = useTrafficLightSpace();
	const navigate = useNavigate();
	const connector = useConnector();
	const createAnchorRef = useTourAnchor( 'sidebar-create-site' );
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
			<div className={ styles.actions } ref={ createAnchorRef }>
				<Menu.Root modal={ false }>
					<Menu.Trigger
						render={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ plus }
								label={ __( 'Create new' ) }
								className={ styles.createButton }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="end">
						<QuickMenuItem
							icon={ wordpress }
							label={ __( 'Add a site' ) }
							onClick={ () => void navigate( { to: '/onboarding' } ) }
						/>
						<QuickMenuItem
							icon={ plugins }
							label={ __( 'Add a plugin' ) }
							onClick={ () => void navigate( { to: '/onboarding/plugin' } ) }
						/>
					</Menu.Popup>
				</Menu.Root>
			</div>
		</div>
	);
}
