import {
	TRACKS_EVENTS,
	type TracksCustomizeEntryPoint,
} from '@studio/common/lib/record-tracks-event';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import {
	chevronRight,
	desktop,
	Icon,
	layout,
	media,
	navigation,
	page,
	pencil,
	styles as stylesIcon,
	symbolFilled,
	widget,
} from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { AgenticSigninBanner } from '@/components/agentic-signin-banner';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import { OfflineBanner } from '@/components/offline-banner';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteHeaderActions } from '@/components/site-header-actions';
import { DATABASE_HOME_PATH } from '@/components/site-preview/location-omnibox';
import { SiteSettingsForm, type SiteSettingsTabId } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOverviewDetails,
	useSites,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { databaseLogo } from '@/lib/logos';
import { AboutSection } from './about-section';
import { OverviewCard } from './overview-card';
import styles from './style.module.css';
import type { SiteDetails, SiteOverviewDetails, SiteOverviewExtension } from '@/data/core';
import type { ReactNode } from 'react';

interface SiteOverviewViewProps {
	siteId: string;
	openSiteDropdown?: boolean;
	activeTab?: SiteOverviewTabId;
	onTabChange?: ( tab: SiteOverviewTabId ) => void;
}

interface OverviewButtonProps {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	loading?: boolean;
	loadingAnnouncement?: string;
	tone?: 'neutral' | 'brand';
	className?: string;
	brandIcon?: boolean;
}

interface ButtonSectionProps {
	title: string;
	children: ReactNode;
	className?: string;
}

interface DetailSectionProps {
	title: string;
	// When provided, the section heading becomes a button that opens the
	// matching wp-admin screen (e.g. "Plugins ›").
	onOpen?: () => void;
	disabled?: boolean;
	children: ReactNode;
}

export type SiteOverviewTabId = 'overview' | SiteSettingsTabId;

export function isSiteOverviewTab( value: string ): value is SiteOverviewTabId {
	return (
		value === 'overview' || value === 'settings' || value === 'agent' || value === 'checkpoints'
	);
}

// Tabs whose content is rendered by the shared SiteSettingsForm.
function isSettingsTab( value: SiteOverviewTabId ): value is SiteSettingsTabId {
	return value === 'settings' || value === 'agent' || value === 'checkpoints';
}

function OverviewHeader( {
	site,
	openSiteDropdown,
}: {
	site: SiteDetails;
	openSiteDropdown: boolean;
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const reserveTrafficLightSpace = useTrafficLightSpace().start;

	return (
		<div
			className={
				sidebarCollapsed && reserveTrafficLightSpace
					? `${ styles.header } ${ styles.headerSidebarCollapsed }`
					: styles.header
			}
		>
			<SiteDropdown
				site={ site }
				showSiteIcon
				showStatus={ sidebarCollapsed }
				floating={ false }
				defaultOpen={ openSiteDropdown }
			/>
			<SiteHeaderActions site={ site } />
		</div>
	);
}

function OverviewButton( {
	icon,
	label,
	onClick,
	disabled,
	loading,
	loadingAnnouncement,
	tone = 'neutral',
	className,
	brandIcon,
}: OverviewButtonProps ) {
	return (
		<Button
			variant="minimal"
			tone={ tone }
			className={ `${ styles.overviewButton } ${ className ?? '' }` }
			disabled={ disabled }
			loading={ loading }
			loadingAnnouncement={ loadingAnnouncement }
			onClick={ onClick }
		>
			<span
				className={
					brandIcon
						? `${ styles.overviewButtonIcon } ${ styles.brandIcon }`
						: styles.overviewButtonIcon
				}
				aria-hidden="true"
			>
				{ icon }
			</span>
			<span className={ styles.overviewButtonLabel } title={ label }>
				{ label }
			</span>
		</Button>
	);
}

function ButtonSection( { title, children, className }: ButtonSectionProps ) {
	return (
		<section className={ `${ styles.buttonSection } ${ className ?? '' }` }>
			<h2>{ title }</h2>
			<div className={ styles.buttonGrid }>{ children }</div>
		</section>
	);
}

function DetailSection( { title, onOpen, disabled, children }: DetailSectionProps ) {
	return (
		<section className={ styles.detailSection }>
			<h2 className={ styles.detailSectionHeading }>
				{ onOpen ? (
					<Button
						variant="minimal"
						className={ styles.sectionHeadingButton }
						disabled={ disabled }
						onClick={ onOpen }
					>
						<span>{ title }</span>
						<span className={ styles.sectionActionIcon } aria-hidden="true">
							<Icon icon={ chevronRight } size={ 18 } />
						</span>
					</Button>
				) : (
					title
				) }
			</h2>
			{ children }
		</section>
	);
}

function getDetailsStatus( { isLoading, isError }: { isLoading: boolean; isError: boolean } ) {
	if ( isLoading ) {
		return __( 'Loading site details...' );
	}
	if ( isError ) {
		return __( 'Site details unavailable.' );
	}
	return null;
}

function OverviewDetailsSections( {
	details,
	isLoading,
	isError,
	onOpenPlugins,
	onOpenThemes,
	disabled,
}: {
	details?: SiteOverviewDetails;
	isLoading: boolean;
	isError: boolean;
	onOpenPlugins: () => void;
	onOpenThemes: () => void;
	disabled?: boolean;
} ) {
	const status = getDetailsStatus( { isLoading, isError } );

	return (
		<div className={ styles.detailsColumn }>
			<ExtensionListSection
				title={ __( 'Plugins' ) }
				items={ details?.plugins }
				status={ status }
				emptyLabel={ __( 'No plugins installed.' ) }
				onOpen={ onOpenPlugins }
				disabled={ disabled }
			/>
			<ExtensionListSection
				title={ __( 'Themes' ) }
				items={ details?.themes }
				status={ status }
				emptyLabel={ __( 'No themes installed.' ) }
				onOpen={ onOpenThemes }
				disabled={ disabled }
			/>
		</div>
	);
}

function ExtensionListSection( {
	title,
	items,
	status,
	emptyLabel,
	onOpen,
	disabled,
}: {
	title: string;
	items?: SiteOverviewExtension[];
	status: string | null;
	emptyLabel: string;
	onOpen?: () => void;
	disabled?: boolean;
} ) {
	return (
		<DetailSection title={ title } onOpen={ onOpen } disabled={ disabled }>
			{ status ? (
				<p className={ styles.detailStatus }>{ status }</p>
			) : items?.length ? (
				<ul className={ styles.extensionList }>
					{ items.map( ( item ) => (
						<li key={ item.slug } className={ styles.extensionItem }>
							<span className={ styles.extensionName }>{ item.name }</span>
							{ getExtensionMeta( item ) ? (
								<span className={ styles.extensionMeta }>{ getExtensionMeta( item ) }</span>
							) : null }
						</li>
					) ) }
				</ul>
			) : (
				<p className={ styles.detailStatus }>{ emptyLabel }</p>
			) }
		</DetailSection>
	);
}

function getExtensionMeta( item: SiteOverviewExtension ) {
	const parts: string[] = [];
	const statusLabel = getExtensionStatusLabel( item.status );

	if ( item.version ) {
		parts.push( sprintf( __( 'Version %s' ), item.version ) );
	}
	if ( statusLabel ) {
		parts.push( statusLabel );
	}

	return parts.join( ' | ' );
}

function getExtensionStatusLabel( status: SiteOverviewExtension[ 'status' ] ) {
	if ( status === 'active' ) {
		return __( 'Active' );
	}
	if ( status === 'inactive' ) {
		return __( 'Inactive' );
	}
	return status ? status.replace( /-/g, ' ' ) : null;
}

function OpenInSection( {
	site,
	busy,
	openSiteUrl,
}: {
	site: SiteDetails;
	busy: boolean;
	openSiteUrl: ( url: string ) => Promise< void >;
} ) {
	const connector = useConnector();
	const { data: preferences } = useUserPreferences();
	const destinations = useOpenInDestinations( site, undefined, '/' );
	const editorConfigured = Boolean( preferences?.editor );
	const apps = destinations.filter(
		( destination ) =>
			destination.id !== 'browser' && ( destination.id !== 'editor' || editorConfigured )
	);

	return (
		<ButtonSection title={ __( 'Open in…' ) }>
			{ apps.map( ( destination ) => (
				<OverviewButton
					key={ destination.id }
					brandIcon
					icon={ <Icon icon={ destination.logo } size={ 18 } /> }
					label={ destination.label }
					disabled={ destination.disabled }
					onClick={ destination.open }
				/>
			) ) }
			<OverviewButton
				brandIcon
				icon={ <Icon icon={ databaseLogo } size={ 18 } /> }
				label={ __( 'phpMyAdmin' ) }
				disabled={ busy }
				onClick={ () => {
					void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN, {
						browser: 'internal',
					} );
					void openSiteUrl( DATABASE_HOME_PATH );
				} }
			/>
		</ButtonSection>
	);
}

export function SiteOverviewView( {
	siteId,
	openSiteDropdown = false,
	activeTab,
	onTabChange,
}: SiteOverviewViewProps ) {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );

	if ( sitesLoading ) {
		return <div className={ styles.state }>{ __( 'Loading…' ) }</div>;
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
		<SiteOverviewBody
			site={ site }
			openSiteDropdown={ openSiteDropdown }
			activeTab={ activeTab }
			onTabChange={ onTabChange }
		/>
	);
}

function SiteOverviewBody( {
	site,
	openSiteDropdown,
	activeTab: controlledActiveTab,
	onTabChange,
}: {
	site: SiteDetails;
	openSiteDropdown: boolean;
	activeTab?: SiteOverviewTabId;
	onTabChange?: ( tab: SiteOverviewTabId ) => void;
} ) {
	const navigate = useNavigate();
	const overviewAnchorRef = useTourAnchor( 'site-overview-content' );
	const settingsTabAnchorRef = useTourAnchor( 'site-settings-tab' );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const overviewDetails = useSiteOverviewDetails( site.id );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const [ localActiveTab, setLocalActiveTab ] = useState< SiteOverviewTabId >( 'overview' );
	const activeTab = controlledActiveTab ?? localActiveTab;
	const managementActions = useSiteManagementActions( site, {
		onDelete: () => setDeleteOpen( true ),
	} );

	const busy = isStarting || isStopping;
	// Checkpoints run on the user's machine (the CLI checkpoint engine), so the
	// tab only exists where the connector can reach it.
	const connector = useConnector();
	const supportsCheckpoints = connector.capabilities?.siteCheckpoints ?? false;
	const themeDetails = site.themeDetails;
	const isBlockTheme = themeDetails?.isBlockTheme === true;
	const { data: wpVersion } = useWpVersion( site.id );

	// Opens WordPress screens in the in-app preview panel (starting the site
	// first when needed) rather than the external browser.
	const openSiteUrl = useOpenSiteUrl( site );
	const openCustomize = ( url: string, entryPoint: TracksCustomizeEntryPoint ) => {
		void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_CUSTOMIZE, {
			entry_point: entryPoint,
			browser: 'internal',
		} );
		void openSiteUrl( url );
	};
	const selectTab = ( tab: SiteOverviewTabId ) => {
		if ( tab === activeTab ) {
			return;
		}
		void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: tab } );
		if ( controlledActiveTab === undefined ) {
			setLocalActiveTab( tab );
		}
		onTabChange?.( tab );
	};

	return (
		<div className={ styles.root }>
			<OverviewHeader site={ site } openSiteDropdown={ openSiteDropdown } />
			<div className={ styles.tabsFrame }>
				<Tabs.Root
					selectedTabId={ activeTab }
					onSelect={ ( tabId ) => {
						if ( tabId && isSiteOverviewTab( tabId ) ) {
							selectTab( tabId );
						}
					} }
				>
					<div className={ styles.tabsBar }>
						<div className={ styles.tabsBarInner }>
							<Tabs.List>
								<Tabs.Tab tabId="overview">{ __( 'Overview' ) }</Tabs.Tab>
								<Tabs.Tab tabId="settings" ref={ settingsTabAnchorRef }>
									{ __( 'Settings' ) }
								</Tabs.Tab>
								<Tabs.Tab tabId="agent">{ __( 'Agent' ) }</Tabs.Tab>
								{ supportsCheckpoints ? (
									<Tabs.Tab tabId="checkpoints">{ __( 'Checkpoints' ) }</Tabs.Tab>
								) : null }
							</Tabs.List>
						</div>
					</div>
					<div className={ styles.scroll }>
						<main className={ styles.content }>
							<Tabs.Panel tabId="overview" className={ styles.overviewPanel }>
								<OfflineBanner />
								<div className={ styles.cardColumn }>
									<h2 className={ styles.columnHeading }>{ __( 'About' ) }</h2>
									<OverviewCard>
										<AboutSection site={ site } wpVersion={ wpVersion } />
									</OverviewCard>
								</div>
								<div className={ styles.actionsColumn } ref={ overviewAnchorRef }>
									<ButtonSection title={ __( 'Customize' ) }>
										{ isBlockTheme ? (
											<>
												<OverviewButton
													icon={ <Icon icon={ desktop } size={ 18 } /> }
													label={ __( 'Site Editor' ) }
													disabled={ busy }
													loading={ isStarting }
													loadingAnnouncement={ __( 'Starting site' ) }
													onClick={ () => openCustomize( '/wp-admin/site-editor.php', 'editor' ) }
												/>
												<OverviewButton
													icon={ <Icon icon={ stylesIcon } size={ 18 } /> }
													label={ __( 'Styles' ) }
													disabled={ busy }
													onClick={ () =>
														openCustomize(
															'/wp-admin/site-editor.php?path=%2Fwp_global_styles',
															'editor_styles'
														)
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ symbolFilled } size={ 18 } /> }
													label={ __( 'Patterns' ) }
													disabled={ busy }
													onClick={ () =>
														openCustomize(
															'/wp-admin/site-editor.php?path=%2Fpatterns',
															'editor_patterns'
														)
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ navigation } size={ 18 } /> }
													label={ __( 'Navigation' ) }
													disabled={ busy }
													onClick={ () =>
														openCustomize(
															'/wp-admin/site-editor.php?path=%2Fnavigation',
															'editor_navigation'
														)
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ layout } size={ 18 } /> }
													label={ __( 'Templates' ) }
													disabled={ busy }
													onClick={ () =>
														openCustomize(
															'/wp-admin/site-editor.php?path=%2Fwp_template',
															'editor_templates'
														)
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ page } size={ 18 } /> }
													label={ __( 'Pages' ) }
													disabled={ busy }
													onClick={ () =>
														openCustomize(
															'/wp-admin/site-editor.php?path=%2Fpage',
															'editor_pages'
														)
													}
												/>
											</>
										) : (
											<>
												<OverviewButton
													icon={ <Icon icon={ pencil } size={ 18 } /> }
													label={ __( 'Customizer' ) }
													disabled={ busy }
													loading={ isStarting }
													loadingAnnouncement={ __( 'Starting site' ) }
													onClick={ () => openCustomize( '/wp-admin/customize.php', 'customizer' ) }
												/>
												{ themeDetails?.supportsMenus ? (
													<OverviewButton
														icon={ <Icon icon={ navigation } size={ 18 } /> }
														label={ __( 'Menus' ) }
														disabled={ busy }
														onClick={ () => openCustomize( '/wp-admin/nav-menus.php', 'menus' ) }
													/>
												) : null }
												{ themeDetails?.supportsWidgets ? (
													<OverviewButton
														icon={ <Icon icon={ widget } size={ 18 } /> }
														label={ __( 'Widgets' ) }
														disabled={ busy }
														onClick={ () => openCustomize( '/wp-admin/widgets.php', 'widgets' ) }
													/>
												) : null }
											</>
										) }
										<OverviewButton
											icon={ <Icon icon={ media } size={ 18 } /> }
											label={ __( 'Media Library' ) }
											disabled={ busy }
											onClick={ () => openCustomize( '/wp-admin/upload.php', 'media_library' ) }
										/>
									</ButtonSection>

									{ connector.capabilities?.openInOS ? (
										<OpenInSection site={ site } busy={ busy } openSiteUrl={ openSiteUrl } />
									) : null }

									<ButtonSection title={ __( 'Manage' ) } className={ styles.manageSection }>
										{ managementActions.map( ( action ) => (
											<OverviewButton
												key={ action.id }
												icon={ <Icon icon={ action.icon } size={ 18 } /> }
												label={ action.label }
												loading={ action.loading }
												loadingAnnouncement={ action.loadingAnnouncement }
												disabled={ action.disabled }
												className={ action.destructive ? styles.destructiveButton : undefined }
												onClick={ action.run }
											/>
										) ) }
									</ButtonSection>
								</div>
								<OverviewDetailsSections
									details={ overviewDetails.data }
									isLoading={ overviewDetails.isLoading }
									isError={ overviewDetails.isError }
									onOpenPlugins={ () => void openSiteUrl( '/wp-admin/plugins.php' ) }
									onOpenThemes={ () => void openSiteUrl( '/wp-admin/themes.php' ) }
									disabled={ busy }
								/>
							</Tabs.Panel>
							{ isSettingsTab( activeTab ) ? (
								<Tabs.Panel tabId={ activeTab } className={ styles.panel }>
									<SiteSettingsForm
										site={ site }
										activeTab={ activeTab }
										onTabChange={ selectTab }
										embedded
										showTabs={ false }
									/>
								</Tabs.Panel>
							) : null }
						</main>
					</div>
				</Tabs.Root>
			</div>
			{ activeTab === 'overview' ? <AgenticSigninBanner /> : null }
			<ProgressiveBlur direction="up" className={ styles.footerBlur } />
			<div className={ styles.footerBar }>
				<PreviewToggleButton />
			</div>
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ () => void navigate( { to: '/' } ) }
			/>
		</div>
	);
}
