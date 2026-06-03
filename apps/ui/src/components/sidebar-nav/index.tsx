import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { category } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { SidebarButton } from '@/components/sidebar-button';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

type NavItem = {
	key: string;
	label: string;
	icon: ComponentProps< typeof Icon >[ 'icon' ];
	to?: ComponentProps< typeof Link >[ 'to' ];
};

function getItems(): NavItem[] {
	return [ { key: 'sites', label: __( 'All Sites' ), icon: category, to: '/sites' } ];
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
									activeOptions={ { exact: true } }
									activeProps={ {
										className: clsx( styles.item, styles.itemActive ),
									} }
								/>
							}
						>
							<span className={ styles.iconSlot }>
								<Icon icon={ item.icon } size={ 28 } />
							</span>
							<span className={ styles.label }>{ item.label }</span>
						</SidebarButton>
					</li>
				) ) }
			</ul>
		</nav>
	);
}
