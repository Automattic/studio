import { getLocalizedLink, REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useResetAppearance, useResetInterface } from '@/data/queries/use-reset-interface';
import { useSidebarPreferences } from '@/data/queries/use-sidebar-pins';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { getSettingCommands } from '@/features/commands/studio-commands';
import type { SiteDetails, UserPreferences } from '@/data/core';
import type { PaletteCommand, SettingToggles } from '@/features/commands/studio-commands';

function useSettingToggles(): SettingToggles {
	const { data: preferences } = useUserPreferences();
	const { showRecentChats, autoCollapseSites } = useSidebarPreferences();
	const save = useSaveUserPreferences();
	const toggle = (
		key: keyof UserPreferences,
		checked: boolean | undefined,
		label: string,
		success: string
	) => ( {
		checked: !! checked,
		label,
		run: () => {
			if ( save.isPending ) return;
			save.mutate(
				{
					[ key ]: ! checked,
					...( key === 'analyticsEnabled' && { source: { surface: 'settings' as const } } ),
				},
				{
					onSuccess: () => toast.success( success ),
					onError: () => toast.error( __( 'Could not update settings. Please try again.' ) ),
				}
			);
		},
	} );
	if ( ! preferences ) {
		return {};
	}
	return {
		'show-recent-chats': toggle(
			'showRecentChats',
			showRecentChats,
			showRecentChats ? __( 'Hide recent chats' ) : __( 'Show recent chats' ),
			showRecentChats ? __( 'Recent chats hidden.' ) : __( 'Recent chats shown.' )
		),
		'collapse-sidebar-groups': toggle(
			'autoCollapseSites',
			autoCollapseSites,
			autoCollapseSites
				? __( 'Disable automatic sidebar collapsing' )
				: __( 'Enable automatic sidebar collapsing' ),
			autoCollapseSites
				? __( 'Automatic sidebar collapsing disabled.' )
				: __( 'Automatic sidebar collapsing enabled.' )
		),
		'auto-start-site': toggle(
			'autoStartSiteOnChat',
			preferences.autoStartSiteOnChat,
			preferences.autoStartSiteOnChat
				? __( 'Disable automatic site start on prompt' )
				: __( 'Enable automatic site start on prompt' ),
			preferences.autoStartSiteOnChat
				? __( 'Automatic site start on prompt disabled.' )
				: __( 'Automatic site start on prompt enabled.' )
		),
		'confirm-delete-annotations': toggle(
			'confirmDeleteAnnotations',
			preferences.confirmDeleteAnnotations,
			preferences.confirmDeleteAnnotations
				? __( 'Disable annotation deletion confirmation' )
				: __( 'Enable annotation deletion confirmation' ),
			preferences.confirmDeleteAnnotations
				? __( 'Annotation deletion confirmation disabled.' )
				: __( 'Annotation deletion confirmation enabled.' )
		),
		'open-chat-on-site-start': toggle(
			'openChatOnSiteStart',
			preferences.openChatOnSiteStart,
			preferences.openChatOnSiteStart
				? __( 'Disable chat opening on site start' )
				: __( 'Enable chat opening on site start' ),
			preferences.openChatOnSiteStart
				? __( 'Chat opening on site start disabled.' )
				: __( 'Chat opening on site start enabled.' )
		),
		'usage-statistics': toggle(
			'analyticsEnabled',
			preferences.analyticsEnabled,
			preferences.analyticsEnabled
				? __( 'Disable anonymous usage statistics' )
				: __( 'Enable anonymous usage statistics' ),
			preferences.analyticsEnabled
				? __( 'Anonymous usage statistics disabled.' )
				: __( 'Anonymous usage statistics enabled.' )
		),
	};
}

export function useSettingCommands(
	scope: 'studio' | 'site',
	site?: SiteDetails
): PaletteCommand[] {
	const openSettings = useOpenSettings();
	const toggles = useSettingToggles();
	const user = useAuthUser();
	const connector = useConnector();
	const locale = useUserLocale();
	const resetAppearance = useResetAppearance();
	const resetInterface = useResetInterface();

	return getSettingCommands( {
		scope,
		site,
		signedIn: ! user.isSuccess || !! user.data,
		capabilities: connector.capabilities,
		toggles,
		actions: {
			'reset-appearance': {
				aliases: [ __( 'Reset appearance tint' ) ],
				run: resetAppearance.reset,
			},
			'reset-interface': { run: resetInterface.reset },
			documentation: {
				label: __( 'Open documentation' ),
				run: () => {
					void connector.openExternalUrl( getLocalizedLink( locale, 'docsStudio' ) );
				},
			},
			'report-issue': {
				run: () => {
					void connector.openExternalUrl( REPORT_ISSUE_URL );
				},
			},
		},
		openSettings,
	} );
}
