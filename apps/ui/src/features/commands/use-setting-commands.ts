import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSidebarPreferences } from '@/data/queries/use-sidebar-pins';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { getSettingCommands } from '@/features/commands/studio-commands';
import type { SiteDetails, UserPreferences } from '@/data/core';
import type { PaletteCommand, SettingToggles } from '@/features/commands/studio-commands';

function useSettingToggles(): SettingToggles {
	const { data: preferences } = useUserPreferences();
	const { showRecentChats, autoCollapseSites } = useSidebarPreferences();
	const save = useSaveUserPreferences();
	const toggle = ( key: keyof UserPreferences, checked: boolean | undefined ) => ( {
		checked: !! checked,
		run: () =>
			save.mutate( {
				[ key ]: ! checked,
				...( key === 'analyticsEnabled' && { source: { surface: 'settings' as const } } ),
			} ),
	} );
	if ( ! preferences ) {
		return {};
	}
	return {
		'show-recent-chats': toggle( 'showRecentChats', showRecentChats ),
		'collapse-sidebar-groups': toggle( 'autoCollapseSites', autoCollapseSites ),
		'auto-start-site': toggle( 'autoStartSiteOnChat', preferences.autoStartSiteOnChat ),
		'confirm-delete-annotations': toggle(
			'confirmDeleteAnnotations',
			preferences.confirmDeleteAnnotations
		),
		'usage-statistics': toggle( 'analyticsEnabled', preferences.analyticsEnabled ),
	};
}

export function useSettingCommands(
	scope: 'studio' | 'site',
	site?: SiteDetails
): PaletteCommand[] {
	const openSettings = useOpenSettings();
	const toggles = useSettingToggles();
	const user = useAuthUser();
	return getSettingCommands( {
		scope,
		site,
		signedIn: ! user.isSuccess || !! user.data,
		toggles,
		openSettings,
	} );
}
