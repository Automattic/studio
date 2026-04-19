import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { category, cog, comment } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import styles from './style.module.css';
import type { ComponentProps } from 'react';

type NavItem = {
	key: string;
	label: string;
	icon: ComponentProps< typeof Icon >[ 'icon' ];
	to?: ComponentProps< typeof Link >[ 'to' ];
};

function getItems(): NavItem[] {
	return [
		{ key: 'chat', label: __( 'Chat' ), icon: comment, to: '/dashboard' },
		{ key: 'settings', label: __( 'Settings' ), icon: cog },
		{ key: 'skills', label: __( 'Skills' ), icon: category },
	];
}

export function SidebarNav() {
	const items = getItems();
	return (
		<nav className={ styles.root }>
			<ul className={ styles.list }>
				{ items.map( ( item ) => (
					<li key={ item.key }>
						{ item.to ? (
							<Link
								to={ item.to }
								className={ styles.item }
								activeProps={ { className: clsx( styles.item, styles.itemActive ) } }
							>
								<Icon icon={ item.icon } size={ 16 } />
								<span>{ item.label }</span>
							</Link>
						) : (
							<button type="button" className={ styles.item }>
								<Icon icon={ item.icon } size={ 16 } />
								<span>{ item.label }</span>
							</button>
						) }
					</li>
				) ) }
			</ul>
		</nav>
	);
}
