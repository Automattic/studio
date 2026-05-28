import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { __ } from '@wordpress/i18n';
import { useMemo, useState } from 'react';
import { useDeskSettings, useUpdateDeskSettings } from '@/data/queries/use-desk-config';
import { Chats, ChatsProvider } from '../chats';
import { useChats } from '../chats/context';
import { getChatPanelShift, useChatPanelResize } from '../chats/use-chat-panel-resize';
import { DeskChrome } from '../chrome';
import { DeskSettingsModal } from '../chrome/settings-modal';
import {
	DEFAULT_DESK_TOOLBAR_LAYOUT,
	getDeskToolbarButtonSide,
	normalizeDeskToolbarSettings,
} from '../chrome/toolbar-layout';
import { Button, LoadingPlaceholder } from '../components';
import { useSiteMapDeskConfig } from '../site-map/use-site-map-desk-config';
import { DeskCanvas } from './canvas';
import { DeskProvider } from './provider';
import { DeskWidgetToolbar } from './selection-toolbar';
import styles from './style.module.css';
import type { CSSProperties, ReactNode } from 'react';

interface DeskProps {
	siteId?: string;
	embedded?: boolean;
}

export function Desk( { siteId, embedded = false }: DeskProps ) {
	if ( siteId ) {
		return <SiteDesk siteId={ siteId } embedded={ embedded } />;
	}

	return <UserDesk embedded={ embedded } />;
}

function UserDesk( { embedded = false }: Pick< DeskProps, 'embedded' > ) {
	return (
		<ChatsProvider>
			<DeskProvider key="user">
				<DeskShell embedded={ embedded }>
					<DeskCanvas />
				</DeskShell>
			</DeskProvider>
		</ChatsProvider>
	);
}

function SiteDesk( {
	siteId,
	embedded = false,
}: Required< Pick< DeskProps, 'siteId' > > & Pick< DeskProps, 'embedded' > ) {
	const [ siteMapOpen, setSiteMapOpen ] = useState( false );
	const siteMap = useSiteMapDeskConfig( siteId, siteMapOpen );
	const providerKey = siteMapOpen ? `${ siteId }:site-map:${ siteMap.signature }` : siteId;

	return (
		<ChatsProvider siteId={ siteId }>
			<DeskProvider
				key={ providerKey }
				siteId={ siteId }
				deskConfig={ siteMapOpen ? siteMap.config : undefined }
				deskConfigKey={ providerKey }
				initialViewportMode={ siteMapOpen ? 'site-map' : undefined }
				isLoading={ siteMapOpen ? siteMap.isLoading : undefined }
				isReadOnly={ siteMapOpen }
				statusMessage={ siteMapOpen ? siteMap.message : undefined }
			>
				<DeskShell
					siteId={ siteId }
					embedded={ embedded }
					siteMapOpen={ siteMapOpen }
					siteMapIsLoading={ siteMapOpen && siteMap.isLoading }
					siteMapPageCount={ siteMapOpen && ! siteMap.isLoading ? siteMap.pageCount : undefined }
					onToggleSiteMap={ () => setSiteMapOpen( ( open ) => ! open ) }
				>
					<DeskCanvas />
				</DeskShell>
			</DeskProvider>
		</ChatsProvider>
	);
}

function DeskShell( {
	siteId,
	embedded = false,
	siteMapOpen,
	siteMapIsLoading,
	siteMapPageCount,
	onToggleSiteMap,
	children,
}: DeskProps & {
	siteMapOpen?: boolean;
	siteMapIsLoading?: boolean;
	siteMapPageCount?: number;
	onToggleSiteMap?: () => void;
	children: ReactNode;
} ) {
	const [ rootElement, setRootElement ] = useState< HTMLElement | null >( null );
	const updateDeskSettings = useUpdateDeskSettings();
	const { data: savedSettings } = useDeskSettings();
	const fallbackSettings = useMemo( () => createDefaultDeskSettings(), [] );
	const settings = useMemo(
		() => normalizeDeskToolbarSettings( savedSettings ?? fallbackSettings ),
		[ fallbackSettings, savedSettings ]
	);
	const chatSide = getDeskToolbarButtonSide( settings.toolbarLayout, 'chat' );
	const chatPanel = useChatPanelResize( chatSide );
	const { open: chatOpen, expanded: chatExpanded } = useChats();
	const chatShift = getChatPanelShift( {
		open: chatOpen,
		expanded: chatExpanded,
		side: chatSide,
		width: chatPanel.width,
	} );
	const rootStyle = {
		'--ui-desks-chat-shift': `${ chatShift }px`,
	} as CSSProperties;
	const [ settingsOpen, setSettingsOpen ] = useState( false );
	const [ editingToolbar, setEditingToolbar ] = useState( false );
	const ShellElement = embedded ? 'div' : 'main';

	return (
		<ShellElement
			ref={ setRootElement }
			className={ styles.root }
			aria-label={ getDeskLabel( siteId ) }
			data-ui-desks-root
			data-ui-desks-embedded={ embedded ? 'true' : undefined }
			data-site-id={ siteId }
			data-toolbar-editing={ editingToolbar ? 'true' : 'false' }
			style={ rootStyle }
		>
			<Chats
				siteId={ siteId }
				side={ chatSide }
				panel={ chatPanel }
				embedded={ embedded }
				container={ rootElement }
			/>
			<DeskChrome
				siteId={ siteId }
				embedded={ embedded }
				siteMapOpen={ siteMapOpen }
				siteMapPageCount={ siteMapPageCount }
				settingsOpen={ settingsOpen }
				editingToolbar={ editingToolbar }
				onToggleSiteMap={ onToggleSiteMap }
				onToggleSettings={ () => setSettingsOpen( ( open ) => ! open ) }
			/>
			{ children }
			{ siteMapIsLoading && <SiteMapLoadingWidget /> }
			<DeskWidgetToolbar />
			<DeskSettingsModal
				open={ settingsOpen }
				onOpenChange={ setSettingsOpen }
				onEditToolbar={ () => setEditingToolbar( true ) }
			/>
			{ editingToolbar && (
				<>
					<button
						type="button"
						className={ styles.toolbarEditBackdrop }
						aria-label={ __( 'Exit toolbar editing' ) }
						onClick={ () => setEditingToolbar( false ) }
					/>
					<div className={ styles.toolbarEditActions }>
						<Button
							type="button"
							label={ __( 'Done' ) }
							variant="chrome"
							size="large"
							onClick={ () => setEditingToolbar( false ) }
						>
							{ __( 'Done' ) }
						</Button>
						<Button
							type="button"
							label={ __( 'Reset' ) }
							variant="chrome"
							size="large"
							onClick={ () => updateDeskSettings( { toolbarLayout: DEFAULT_DESK_TOOLBAR_LAYOUT } ) }
						>
							{ __( 'Reset' ) }
						</Button>
					</div>
				</>
			) }
		</ShellElement>
	);
}

function SiteMapLoadingWidget() {
	return (
		<div className={ styles.siteMapLoadingWidget } aria-live="polite" data-ui-desks-loading>
			<LoadingPlaceholder text={ __( 'Loading site map' ) } />
		</div>
	);
}

function getDeskLabel( siteId?: string ) {
	return siteId ? __( 'Site desk' ) : __( 'User desk' );
}
