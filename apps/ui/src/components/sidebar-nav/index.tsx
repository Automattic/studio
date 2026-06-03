import { Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { category, download, globe, plus } from '@wordpress/icons';
import { Icon, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import * as Menu from '@/components/menu';
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

function AllSitesCreateMenu() {
	const navigate = useNavigate();

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ plus }
						label={ __( 'Create new' ) }
						className={ styles.itemAction }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end" className={ styles.popup }>
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
	const items = getItems();
	return (
		<nav className={ styles.root }>
			<ul className={ styles.list }>
				{ items.map( ( item ) => (
					<li key={ item.key } className={ styles.listItem }>
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
						<div className={ styles.itemActions }>
							<AllSitesCreateMenu />
						</div>
					</li>
				) ) }
			</ul>
		</nav>
	);
}
