import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { SidebarButton } from '@/components/sidebar-button';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

type NavItem = {
	key: string;
	label: string;
	icon: ComponentProps< typeof Icon >[ 'icon' ];
	to: ComponentProps< typeof Link >[ 'to' ];
};

function getItems(): NavItem[] {
	return [ { key: 'settings', label: __( 'Settings' ), icon: cog, to: '/settings' } ];
}

export function SidebarNav() {
	const items = getItems();
	return (
		<nav className={ styles.root }>
			<ul className={ styles.list }>
				{ items.map( ( item ) => (
					<li key={ item.key }>
						<SidebarButton
							className={ styles.item }
							render={
								<Link
									to={ item.to }
									activeProps={ {
										className: clsx( styles.item, styles.itemActive ),
									} }
								/>
							}
						>
							<Icon icon={ item.icon } />
							<span>{ item.label }</span>
						</SidebarButton>
					</li>
				) ) }
			</ul>
		</nav>
	);
}
