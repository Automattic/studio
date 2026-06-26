import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { SidebarButton } from '@/components/sidebar-button';
import styles from './style.module.css';

export function SidebarCreateMenu() {
	const navigate = useNavigate();

	return (
		<div className={ styles.root }>
			<SidebarButton
				className={ styles.createButton }
				onClick={ () => void navigate( { to: '/onboarding' } ) }
			>
				<Icon icon={ plus } />
				<span>{ __( 'Add new site' ) }</span>
			</SidebarButton>
		</div>
	);
}
