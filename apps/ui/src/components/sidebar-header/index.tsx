import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { comment, download, globe, menu, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { drawerIcon } from '@/lib/icons';
import styles from './style.module.css';
import type { MouseEvent } from 'react';

type Props = {
	onToggleSidebar: () => void;
};

export function SidebarHeader( { onToggleSidebar }: Props ) {
	const reserveTrafficLightSpace = useTrafficLightSpace();
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
					<Menu.Popup side="bottom" align="end" className={ styles.popup }>
						<Menu.Item>
							<Icon icon={ comment } />
							<span>{ __( 'New chat' ) }</span>
						</Menu.Item>
						<Menu.Item onClick={ () => void navigate( { to: '/onboarding' } ) }>
							<Icon icon={ globe } />
							<span>{ __( 'New site' ) }</span>
						</Menu.Item>
						<Menu.Item onClick={ () => void navigate( { to: '/onboarding/import' } ) }>
							<Icon icon={ download } />
							<span>{ __( 'Import from…' ) }</span>
						</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ drawerIcon }
					label={ __( 'Hide sidebar' ) }
					onClick={ onToggleSidebar }
				/>
			</div>
		</div>
	);
}
