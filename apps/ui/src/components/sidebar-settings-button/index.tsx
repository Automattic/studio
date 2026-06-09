import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { SidebarButton } from '@/components/sidebar-button';
import styles from './style.module.css';

export function SidebarSettingsButton( { showTopBorder = false }: { showTopBorder?: boolean } ) {
	return (
		<div className={ clsx( styles.root, showTopBorder && styles.rootWithTopBorder ) }>
			<SidebarButton
				className={ styles.button }
				render={
					<Link
						to="/settings"
						activeOptions={ { exact: true, includeSearch: false } }
						activeProps={ {
							className: clsx( styles.button, styles.buttonActive ),
						} }
					/>
				}
			>
				<span className={ styles.iconSlot } aria-hidden="true">
					<Icon icon={ cog } size={ 22 } className={ styles.icon } data-sidebar-primary-icon />
				</span>
				<span className={ styles.label }>{ __( 'Preferences' ) }</span>
			</SidebarButton>
		</div>
	);
}
