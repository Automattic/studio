import { findAiSessionOwnerSite } from '@studio/agent/protocol/sessions/owner-site';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useColorScheme } from '@/data/host/use-color-scheme';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useSaveUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenFeedback } from '@/data/use-open-feedback';
import { useOpenSettings } from '@/data/use-open-settings';
import { useOpenSite } from '@/data/use-open-site';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { useSidebarOpen, useToggleSidebar } from '@/data/use-sidebar-collapsed';
import { useUserWorkspaceLayoutTransition } from '@/data/use-workspace-layout-tracks';
import { getAppCommands, getPaletteChats } from '@/features/commands/studio-commands';
import { useSettingCommands } from '@/features/commands/use-setting-commands';
import { useOpenWhatsNew } from '@/features/onboarding';
import { useCollapseAll } from '@/features/sidebar';
import { useOpenAddSite } from '@/features/sites';
import { useHasOpenDialog } from '@/lib/ui';
import type { PaletteCommand } from '@/features/commands/studio-commands';

// The commands available everywhere: sites, chats, settings and the app's own.
export function useAppCommands(): PaletteCommand[] {
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const openAddSite = useOpenAddSite();
	const { data: sites = [] } = useSites();
	const { data: sessions = [] } = useSessions();
	const openSite = useOpenSite();
	const preview = useOptionalSessionPreviewUI();
	const runLayoutTransition = useUserWorkspaceLayoutTransition();
	const sidebarOpen = useSidebarOpen();
	const toggleSidebar = useToggleSidebar();
	const hasOpenDialog = useHasOpenDialog();
	const [ pendingSidebarToggle, setPendingSidebarToggle ] = useState( false );
	useEffect( () => {
		if ( ! pendingSidebarToggle || hasOpenDialog ) return;
		setPendingSidebarToggle( false );
		toggleSidebar();
	}, [ pendingSidebarToggle, hasOpenDialog, toggleSidebar ] );
	const colorScheme = useColorScheme();
	const savePreferences = useSaveUserPreferences();
	const collapseAll = useCollapseAll();
	const settingCommands = useSettingCommands( 'studio' );
	const openWhatsNew = useOpenWhatsNew();
	const openFeedback = useOpenFeedback();

	return getAppCommands( {
		sites,
		chats: getPaletteChats( sessions, sites ),
		colorScheme,
		sidebarOpen,
		settingCommands,
		openAddSite: () => openAddSite(),
		openSettings: () => openSettings(),
		openSite,
		openChat: ( session ) => {
			const owner = findAiSessionOwnerSite( sites, session );
			runLayoutTransition(
				() => {
					if ( owner ) preview?.setChatHidden( false, owner.id );
					return navigate( { to: '/sessions/$sessionId', params: { sessionId: session.id } } );
				},
				owner?.id
			);
		},
		savePreferences: ( preferences ) =>
			savePreferences.mutate( preferences, {
				onError: () => toast.error( __( 'Could not update settings. Please try again.' ) ),
			} ),
		toggleSidebar: () => setPendingSidebarToggle( true ),
		openWhatsNew,
		openFeedback,
		collapseAll,
	} );
}
