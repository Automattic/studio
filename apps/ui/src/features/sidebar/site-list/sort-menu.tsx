import { __ } from '@wordpress/i18n';
import { SortIcon } from '@/lib/icons';
import { IconButton, Menu } from '@/lib/ui';
import styles from './style.module.css';
import type { useSidebarPreferences } from '@/data/queries/use-sidebar-pins';
import type { ReactNode } from 'react';

type Preferences = ReturnType< typeof useSidebarPreferences >;

function SortMenu( { label, children }: { label: string; children: ReactNode } ) {
	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<IconButton
						variant="muted-ghost"
						size="icon-sm"
						icon={ <SortIcon /> }
						label={ label }
						className={ styles.groupHoverAction }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="start">
				{ children }
			</Menu.Popup>
		</Menu.Root>
	);
}

export function PinnedSortMenu( { pinnedSort, save }: Pick< Preferences, 'pinnedSort' | 'save' > ) {
	return (
		<SortMenu label={ __( 'Sort by' ) }>
			<Menu.RadioGroup
				aria-label={ __( 'Sort pinned items by' ) }
				value={ pinnedSort }
				onValueChange={ ( sidebarPinnedSort ) => save( { sidebarPinnedSort } ) }
			>
				<Menu.RadioItem value="type">{ __( 'Type' ) }</Menu.RadioItem>
				<Menu.RadioItem value="manual">{ __( 'Manual order' ) }</Menu.RadioItem>
			</Menu.RadioGroup>
		</SortMenu>
	);
}

export function SitesSortMenu( {
	siteSort,
	chatSort,
	save,
}: Pick< Preferences, 'siteSort' | 'chatSort' | 'save' > ) {
	return (
		<SortMenu label={ __( 'Sort by' ) }>
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger>{ __( 'Sort sites by' ) }</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					<Menu.RadioGroup
						aria-label={ __( 'Sort sites by' ) }
						value={ siteSort }
						onValueChange={ ( sidebarSiteSort ) => save( { sidebarSiteSort } ) }
					>
						<Menu.RadioItem value="status">{ __( 'Status' ) }</Menu.RadioItem>
						<Menu.RadioItem value="manual">{ __( 'Manual order' ) }</Menu.RadioItem>
					</Menu.RadioGroup>
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger>{ __( 'Sort chats by' ) }</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					<Menu.RadioGroup
						aria-label={ __( 'Sort chats by' ) }
						value={ chatSort }
						onValueChange={ ( sidebarChatSort ) => save( { sidebarChatSort } ) }
					>
						<Menu.RadioItem value="updated">{ __( 'Last updated' ) }</Menu.RadioItem>
						<Menu.RadioItem value="manual">{ __( 'Manual order' ) }</Menu.RadioItem>
					</Menu.RadioGroup>
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
		</SortMenu>
	);
}
