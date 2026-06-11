import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { SidebarButton } from '@/components/sidebar-button';
import styles from './style.module.css';

export function SidebarSettingsButton() {
	return (
		<div className={ styles.root }>
			<SidebarButton
				className={ styles.button }
				render={
					<Link
						to="/settings"
						activeProps={ {
							className: clsx( styles.button, styles.buttonActive ),
						} }
					/>
				}
			>
				<Icon icon={ cog } />
				<span className={ styles.label }>{ __( 'Settings' ) }</span>
			</SidebarButton>
		</div>
	);
}
