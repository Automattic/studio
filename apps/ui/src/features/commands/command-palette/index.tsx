import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { setCommandPaletteOpen, useCommandPaletteOpen } from '@/data/use-command-palette';
import { useOpenHeaderPanel } from '@/data/use-open-header-panel';
import { useOpenSettings } from '@/data/use-open-settings';
import { useSessionUIDispatch, useSessionPreviewUI } from '@/data/use-session-ui';
import { setAnnotating, useSiteAnnotations } from '@/features/annotations';
import { useChatActions } from '@/features/chats';
import { getSiteCommands } from '@/features/commands/site-commands';
import { getChatCommands } from '@/features/commands/studio-commands';
import { useAppCommands } from '@/features/commands/use-app-commands';
import { useSettingCommands } from '@/features/commands/use-setting-commands';
import {
	useSiteActions,
	useOpenInDestinations,
	useSiteManagementActions,
	getSiteUrl,
} from '@/features/sites';
import { isShortcut } from '@/lib/keyboard';
import { replaceOpenDialogs } from '@/lib/ui';
import { PaletteDialog, type PaletteProps } from './palette-dialog';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

/**
 * ⌘K (Ctrl+K elsewhere) searches sites, chats and the commands for the current
 * site and chat.
 */
export function CommandPalette( {
	site,
	session,
	chatHidden,
}: {
	site?: SiteDetails;
	session?: AiSessionSummary;
	// Set where the chat can be hidden beside the preview.
	chatHidden?: boolean;
} ) {
	const open = useCommandPaletteOpen();
	const commands = useAppCommands();

	// Takes the place of a replaceable dialog (Settings, Add site); other dialogs keep ⌘K.
	useEffect( () => {
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( event.defaultPrevented || event.repeat || ! isShortcut( event, 'k' ) ) {
				return;
			}
			if ( open ) {
				event.preventDefault();
				setCommandPaletteOpen( false );
			} else if ( replaceOpenDialogs( () => setCommandPaletteOpen( true ) ) ) {
				event.preventDefault();
			}
		};
		document.addEventListener( 'keydown', onKeyDown );
		return () => document.removeEventListener( 'keydown', onKeyDown );
	}, [ open ] );

	const palette = { open, onOpenChange: setCommandPaletteOpen, commands };
	return site ? (
		<SiteCommands
			key={ site.id }
			site={ site }
			session={ session }
			chatHidden={ chatHidden }
			{ ...palette }
		/>
	) : (
		<PaletteDialog { ...palette } />
	);
}

function SiteCommands( {
	site,
	session,
	chatHidden,
	commands,
	...palette
}: PaletteProps & { site: SiteDetails; session?: AiSessionSummary; chatHidden?: boolean } ) {
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const connector = useConnector();
	const actions = useSiteActions( site );
	const destinations = useOpenInDestinations( site );
	const manage = useSiteManagementActions( site, {
		onDelete: actions.openDelete,
		onImport: actions.openImport,
	} );
	const preview = useSessionPreviewUI();
	const dispatch = useSessionUIDispatch();
	const openHeaderPanel = useOpenHeaderPanel();
	const annotations = useSiteAnnotations( site.id );
	const settingCommands = useSettingCommands( 'site', site );

	const { assistant } = connector.capabilities;
	const siteCommands = getSiteCommands( {
		site,
		chatHidden: assistant ? chatHidden : undefined,
		previewShown: preview.open && preview.siteId === site.id,
		canAnnotate: connector.capabilities.annotatePreview,
		canOpenDatabase: connector.capabilities.phpMyAdmin,
		annotating: annotations.active,
		actions,
		destinations,
		manage,
		settingCommands,
		openSettings,
		openHeaderPanel,
		newChat: () => void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } ),
		reloadPreview: () => dispatch( { type: 'preview/reload' } ),
		annotate: ( active ) => setAnnotating( site.id, active ),
		showPreview: ( show ) => {
			preview.setSite( site.id );
			preview.setOpen( show );
		},
		setChatHidden: preview.setChatHidden,
		copyUrl: () =>
			void connector
				.copyText( getSiteUrl( site ) )
				.then( () => toast.success( __( 'Site URL copied' ) ) ),
	} );

	// Without the assistant there are no chats, and the preview is always shown.
	const shownCommands = assistant
		? siteCommands
		: siteCommands.filter(
				( command ) => command.id !== 'new-chat' && command.id !== 'preview-visibility'
		  );
	const props = { ...palette, commands: [ ...commands, ...shownCommands ] };
	return (
		<>
			{ session && ! session.archived ? (
				<ChatCommands key={ session.id } session={ session } { ...props } />
			) : (
				<PaletteDialog { ...props } />
			) }
			{ actions.dialogs }
		</>
	);
}

function ChatCommands( {
	session,
	commands,
	...palette
}: PaletteProps & { session: AiSessionSummary } ) {
	const actions = useChatActions( session, true );
	return (
		<>
			<PaletteDialog
				{ ...palette }
				commands={ [ ...commands, ...getChatCommands( session, actions ) ] }
			/>
			{ actions.renameDialog }
		</>
	);
}
