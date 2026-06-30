import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { download, globe, plus } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import styles from './style.module.css';

export function SidebarCreateMenu() {
	const navigate = useNavigate();

	return (
		<div className={ styles.root }>
			<Menu.Root modal={ false }>
				<Menu.Trigger
					render={
						<SidebarButton className={ styles.createButton }>
							<Icon icon={ plus } />
							<span>{ __( 'Add new site' ) }</span>
						</SidebarButton>
					}
				/>
				<Menu.Popup side="top" align="start" className={ styles.popup }>
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
		</div>
	);
}
