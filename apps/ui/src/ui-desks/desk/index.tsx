import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { DeskChats } from '../chats';
import { DeskChrome } from '../chrome';
import { LoadingPlaceholder } from '../components';
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
	return (
		<>
			<DeskChats siteId={ siteId } />
			<main className={ styles.root } aria-label={ getDeskLabel( siteId ) } data-site-id={ siteId }>
				<DeskChrome
					siteId={ siteId }
					siteMapOpen={ siteMapOpen }
					siteMapPageCount={ siteMapPageCount }
					onToggleSiteMap={ onToggleSiteMap }
				/>
				{ children }
				{ siteMapIsLoading && <SiteMapLoadingWidget /> }
				<DeskWidgetToolbar />
			</main>
		</>
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
