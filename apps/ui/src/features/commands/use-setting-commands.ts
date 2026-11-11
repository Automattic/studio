import { getLocalizedLink, REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useResetAppearance, useResetInterface } from '@/data/queries/use-reset-interface';
import { useSidebarPreferences } from '@/data/queries/use-sidebar-pins';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { getSettingCommands } from '@/features/commands/studio-commands';
import { ResetTipsIcon } from '@/lib/icons';
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
		'hide-frontend-admin-bar': toggle(
			'hideFrontendAdminBar',
			preferences.hideFrontendAdminBar,
			preferences.hideFrontendAdminBar
				? __( 'Show admin bar by default' )
				: __( 'Hide admin bar by default' ),
			preferences.hideFrontendAdminBar
				? __( 'Admin bar shown by default.' )
				: __( 'Admin bar hidden by default.' )
		),
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
		'batch-notes': toggle(
			'batchAnnotations',
			preferences.batchAnnotations ?? true,
			preferences.batchAnnotations ?? true
				? __( 'Disable batch notes' )
				: __( 'Enable batch notes' ),
			preferences.batchAnnotations ?? true
				? __( 'Batch notes disabled.' )
				: __( 'Batch notes enabled.' )
		),

		'open-chat-on-site-start': toggle(
			'openChatOnSiteStart',
			preferences.openChatOnSiteStart,
			preferences.openChatOnSiteStart
				? __( 'Hide chat when starting sites' )
				: __( 'Show chat when starting sites' ),
			preferences.openChatOnSiteStart
				? __( 'Sites will start with the panel expanded.' )
				: __( 'Sites will start with chat.' )
		),
		...( ! preferences.analyticsEnabled && {
			'usage-statistics': toggle(
				'analyticsEnabled',
				false,
				__( 'Enable anonymous usage statistics' ),
				__( 'Anonymous usage statistics enabled.' )
			),
		} ),
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
	const setHints = useSetOnboardingHints();

	const commands = getSettingCommands( {
		scope,
		site,
		signedIn: ! user.isSuccess || !! user.data,
		nativeSites: connector.capabilities.nativeSites,
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
	if ( scope === 'studio' ) {
		commands.push( {
			id: 'reset-tips',
			group: 'commands',
			label: __( 'Reset tips' ),
			icon: ResetTipsIcon,
			keywords: [ __( 'Hints' ), __( 'First use' ) ],
			run: () => {
				if ( setHints.isPending ) return;
				setHints.mutate(
					{ annotateHintDismissed: false },
					{
						onSuccess: () => toast.success( __( 'Tips reset.' ) ),
						onError: () => toast.error( __( 'Could not reset tips. Please try again.' ) ),
					}
				);
			},
		} );
	}
	return commands;
}
