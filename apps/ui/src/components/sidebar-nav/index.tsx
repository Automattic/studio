import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { addTemplate, download, globe } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import styles from './style.module.css';

function CreateSiteMenu() {
	const navigate = useNavigate();

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<SidebarButton className={ styles.item }>
						<span className={ styles.iconSlot }>
							<Icon
								icon={ addTemplate }
								size={ 22 }
								className={ styles.icon }
								data-sidebar-primary-icon
							/>
						</span>
						<span className={ styles.label }>{ __( 'Add a site' ) }</span>
					</SidebarButton>
				}
			/>
			<Menu.Popup side="bottom" align="start" className={ styles.popup }>
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
	);
}

export function SidebarNav() {
	return (
		<nav className={ styles.root } aria-label={ __( 'Site actions' ) }>
			<CreateSiteMenu />
		</nav>
	);
}
