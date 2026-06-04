import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo } from 'react';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { useDeskConfig } from '@/data/queries/use-desk-config';
import { useIsSiteStarting, useSites, useStartSite } from '@/data/queries/use-sites';
import { WordPressDataProvider } from '@/data/wordpress/provider';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { DeskCanvas } from '@/ui-desks/desk/canvas';
import { DeskProvider } from '@/ui-desks/desk/provider';
import { useSiteMapDeskConfig } from '@/ui-desks/site-map/use-site-map-desk-config';
import { createSiteMapCanvasDeskConfig, createThemeCanvasDeskConfig } from './layout';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { DeskConfig } from '@/ui-desks/desk/types';

export type SiteCanvasViewKind = 'site-map' | 'theme';

interface SiteCanvasViewProps {
	siteId: string;
	view?: SiteCanvasViewKind;
}

export function SiteCanvasView( { siteId, view = 'site-map' }: SiteCanvasViewProps ) {
	const navigate = useNavigate();
	const { data: sites, isLoading } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );

	if ( isLoading ) {
		return <div className={ styles.state }>{ __( 'Loading...' ) }</div>;
	}

	if ( ! site ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Site not found' ) }</h1>
				<p>{ siteId }</p>
			</div>
		);
	}

	return (
		<WordPressDataProvider key={ site.id } siteId={ site.id }>
			<SiteCanvasContent
				site={ site }
				view={ view }
				onOpenSettings={ () =>
					void navigate( {
						to: '/sites/$siteId/settings',
						params: { siteId: site.id },
					} )
				}
			/>
		</WordPressDataProvider>
	);
}

function SiteCanvasContent( {
	site,
	view,
	onOpenSettings,
}: {
	site: SiteDetails;
	view: SiteCanvasViewKind;
	onOpenSettings: () => void;
} ) {
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const isStartingSite = startSite.isPending || isStarting;

	if ( ! site.running ) {
		return (
			<div className={ styles.root }>
				<SiteCanvasHeader site={ site } onOpenSettings={ onOpenSettings } />
				<main className={ styles.deskRoot } aria-label={ __( 'Site canvas' ) }>
					<div className={ styles.stoppedState }>
						<div className={ styles.stoppedStateContent }>
							<h2 className={ styles.stoppedStateTitle }>{ getStoppedStateTitle( view ) }</h2>
							<p className={ styles.stoppedStateText }>{ getStoppedStateDescription( view ) }</p>
							<Button
								variant="solid"
								tone="brand"
								loading={ isStartingSite }
								loadingAnnouncement={ __( 'Starting site' ) }
								disabled={ isStartingSite }
								onClick={ () => startSite.mutate( site.id ) }
							>
								{ isStartingSite ? __( 'Starting…' ) : __( 'Start site' ) }
							</Button>
						</div>
					</div>
				</main>
			</div>
		);
	}

	return (
		<div className={ styles.root }>
			<SiteCanvasHeader site={ site } onOpenSettings={ onOpenSettings } />
			{ view === 'theme' ? (
				<ThemeCanvasPanel site={ site } />
			) : (
				<SiteMapCanvasPanel site={ site } />
			) }
		</div>
	);
}

export function SiteCanvasExplorerPanel( {
	site,
	view,
}: {
	site: SiteDetails;
	view: SiteCanvasViewKind;
} ) {
	const startSite = useStartSite();
	const isStarting = useIsSiteStarting( site.id );
	const isStartingSite = startSite.isPending || isStarting;

	if ( ! site.running ) {
		return (
			<div className={ styles.panelStoppedState }>
				<div className={ styles.stoppedStateContent }>
					<h2 className={ styles.stoppedStateTitle }>{ getStoppedStateTitle( view ) }</h2>
					<p className={ styles.stoppedStateText }>{ getStoppedStateDescription( view ) }</p>
					<Button
						variant="solid"
						tone="brand"
						loading={ isStartingSite }
						loadingAnnouncement={ __( 'Starting site' ) }
						disabled={ isStartingSite }
						onClick={ () => startSite.mutate( site.id ) }
					>
						{ isStartingSite ? __( 'Starting…' ) : __( 'Start site' ) }
					</Button>
				</div>
			</div>
		);
	}

	return view === 'theme' ? (
		<ThemeCanvasPanel site={ site } />
	) : (
		<SiteMapCanvasPanel site={ site } />
	);
}

export function SiteMapCanvasPanel( { site }: { site: SiteDetails } ) {
	const siteMap = useSiteMapDeskConfig( site.id, true );
	const persistenceSiteId = getCanvasPersistenceSiteId( site.id, 'site-map' );
	const { data: savedDeskConfig, isLoading: isLoadingSavedDeskConfig } =
		useDeskConfig( persistenceSiteId );
	const deskConfig = useMemo(
		() =>
			createSiteMapCanvasDeskConfig( siteMap.config, savedDeskConfig as DeskConfig | undefined ),
		[ savedDeskConfig, siteMap.config ]
	);
	const providerKey = `site-map-canvas:${ site.id }`;
	const deskConfigKey = `${ providerKey }:${ siteMap.signature }`;
	const isLoadingCanvasConfig = siteMap.isLoading || isLoadingSavedDeskConfig;

	return (
		<DeskProvider
			key={ providerKey }
			siteId={ site.id }
			persistenceSiteId={ persistenceSiteId }
			deskConfig={ deskConfig }
			deskConfigKey={ deskConfigKey }
			initialViewportMode="site-map"
			isLoading={ isLoadingCanvasConfig }
			isLayoutOnly
			statusMessage={ siteMap.message }
		>
			<main className={ styles.deskRoot } aria-label={ __( 'Site map canvas' ) }>
				<DeskCanvas
					allowContextMenu={ false }
					allowTextCreation={ false }
					className={ styles.embeddedCanvas }
					enableComposerDrop={ false }
				/>
			</main>
		</DeskProvider>
	);
}

export function ThemeCanvasPanel( { site }: { site: SiteDetails } ) {
	const persistenceSiteId = getCanvasPersistenceSiteId( site.id, 'theme' );
	const { data: savedDeskConfig, isLoading: isLoadingSavedDeskConfig } =
		useDeskConfig( persistenceSiteId );
	const deskConfig = useMemo(
		() => createThemeCanvasDeskConfig( savedDeskConfig as DeskConfig | undefined ),
		[ savedDeskConfig ]
	);
	const providerKey = `theme-canvas:${ site.id }`;

	return (
		<DeskProvider
			key={ providerKey }
			siteId={ site.id }
			persistenceSiteId={ persistenceSiteId }
			deskConfig={ deskConfig }
			deskConfigKey={ providerKey }
			isLoading={ isLoadingSavedDeskConfig }
			isLayoutOnly
		>
			<main className={ styles.deskRoot } aria-label={ __( 'Theme canvas' ) }>
				<DeskCanvas
					allowContextMenu={ false }
					allowTextCreation={ false }
					className={ styles.embeddedCanvas }
					enableComposerDrop={ false }
				/>
			</main>
		</DeskProvider>
	);
}

function SiteCanvasHeader( {
	site,
	onOpenSettings,
}: {
	site: SiteDetails;
	onOpenSettings: () => void;
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();

	return (
		<div className={ styles.header }>
			<ProgressiveBlur />
			<div
				className={ clsx(
					styles.headerContent,
					! sidebarCollapsed && styles.headerContentSidebarOpen
				) }
			>
				{ sidebarCollapsed && ! isFullscreen ? (
					<span className={ styles.trafficLightSpacer } aria-hidden="true" />
				) : null }
				<SiteDropdown
					site={ site }
					showSiteIcon={ sidebarCollapsed }
					onSettingsClick={ onOpenSettings }
				/>
			</div>
		</div>
	);
}

function getCanvasPersistenceSiteId( siteId: string, view: SiteCanvasViewKind ) {
	return `${ siteId }:${ view }`;
}

function getStoppedStateTitle( view: SiteCanvasViewKind ) {
	return view === 'theme'
		? __( 'Start this site to view its theme' )
		: __( 'Start this site to view its site map' );
}

function getStoppedStateDescription( view: SiteCanvasViewKind ) {
	return view === 'theme'
		? __( 'Theme colors, styles, templates, and patterns load once the local site is running.' )
		: __( 'The site map loads once the local site is running.' );
}
