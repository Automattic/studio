import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { useUpdateDeskSettings } from '@/data/queries/use-desk-config';
import { Chats, ChatsProvider } from '../chats';
import { DeskChrome } from '../chrome';
import { DeskSettingsModal } from '../chrome/settings-modal';
import { DEFAULT_DESK_TOOLBAR_LAYOUT } from '../chrome/toolbar-layout';
import { ActionButton, LoadingPlaceholder } from '../components';
import { useSiteMapDeskConfig } from '../site-map/use-site-map-desk-config';
import { DeskWidgetToolbar } from '../widgets/toolbar';
import { DeskCanvas } from './canvas';
import { DeskProvider } from './provider';
import styles from './style.module.css';
import type { ReactNode } from 'react';

interface DeskProps {
	siteId?: string;
}

export function Desk( { siteId }: DeskProps ) {
	if ( siteId ) {
		return <SiteDesk siteId={ siteId } />;
	}

	return <UserDesk />;
}

function UserDesk() {
	return (
		<DeskProvider key="user">
			<DeskShell>
				<DeskCanvas />
			</DeskShell>
		</DeskProvider>
	);
}

function SiteDesk( { siteId }: Required< DeskProps > ) {
	const [ siteMapOpen, setSiteMapOpen ] = useState( false );
	const siteMap = useSiteMapDeskConfig( siteId, siteMapOpen );
	const providerKey = siteMapOpen ? `${ siteId }:site-map:${ siteMap.signature }` : siteId;

	return (
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
				siteMapOpen={ siteMapOpen }
				siteMapIsLoading={ siteMapOpen && siteMap.isLoading }
				siteMapPageCount={ siteMapOpen && ! siteMap.isLoading ? siteMap.pageCount : undefined }
				onToggleSiteMap={ () => setSiteMapOpen( ( open ) => ! open ) }
			>
				<DeskCanvas />
			</DeskShell>
		</DeskProvider>
	);
}

function DeskShell( {
	siteId,
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
	const updateDeskSettings = useUpdateDeskSettings();
	const [ settingsOpen, setSettingsOpen ] = useState( false );
	const [ editingToolbar, setEditingToolbar ] = useState( false );

	return (
		<ChatsProvider siteId={ siteId }>
			<Chats siteId={ siteId } />
			<main
				className={ styles.root }
				aria-label={ getDeskLabel( siteId ) }
				data-site-id={ siteId }
				data-toolbar-editing={ editingToolbar ? 'true' : 'false' }
			>
				<DeskChrome
					siteId={ siteId }
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
							<ActionButton
								type="button"
								className={ styles.toolbarEditButton }
								onClick={ () => setEditingToolbar( false ) }
							>
								{ __( 'Done' ) }
							</ActionButton>
							<ActionButton
								type="button"
								className={ styles.toolbarEditButton }
								onClick={ () =>
									updateDeskSettings( { toolbarLayout: DEFAULT_DESK_TOOLBAR_LAYOUT } )
								}
							>
								{ __( 'Reset' ) }
							</ActionButton>
						</div>
					</>
				) }
			</main>
		</ChatsProvider>
	);
}

function SiteMapLoadingWidget() {
	return (
		<div className={ styles.siteMapLoadingWidget } aria-live="polite">
			<LoadingPlaceholder text={ __( 'Loading site map' ) } />
		</div>
	);
}

function getDeskLabel( siteId?: string ) {
	return siteId ? __( 'Site desk' ) : __( 'User desk' );
}
