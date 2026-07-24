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
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteHeaderActions } from '@/components/site-header-actions';
import { SiteSettingsForm, type SiteSettingsTabId } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOverviewDetails,
	useSites,
} from '@/data/queries/use-sites';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import styles from './style.module.css';
import type { SiteDetails, SiteOverviewDetails, SiteOverviewExtension } from '@/data/core';
import type { ReactNode } from 'react';

interface SiteOverviewViewProps {
	siteId: string;
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

type SiteOverviewTabId = 'overview' | SiteSettingsTabId;

function isSiteOverviewTab( value: string ): value is SiteOverviewTabId {
	return (
		value === 'overview' || value === 'settings' || value === 'agent' || value === 'checkpoints'
	);
}

// Tabs whose content is rendered by the shared SiteSettingsForm.
function isSettingsTab( value: SiteOverviewTabId ): value is SiteSettingsTabId {
	return value === 'settings' || value === 'agent' || value === 'checkpoints';
}

function OverviewHeader( { site }: { site: SiteDetails } ) {
	const sidebarCollapsed = useSidebarCollapsed();

	return (
		<div
			className={
				sidebarCollapsed ? `${ styles.header } ${ styles.headerSidebarCollapsed }` : styles.header
			}
		>
			<SiteDropdown site={ site } showSiteIcon showStatus={ sidebarCollapsed } floating={ false } />
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
			<span className={ styles.overviewButtonIcon } aria-hidden="true">
				{ icon }
			</span>
			<span className={ styles.overviewButtonLabel }>{ label }</span>
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

export function SiteOverviewView( { siteId }: SiteOverviewViewProps ) {
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

	return <SiteOverviewBody site={ site } />;
}

function SiteOverviewBody( { site }: { site: SiteDetails } ) {
	const navigate = useNavigate();
	const overviewAnchorRef = useTourAnchor( 'site-overview-content' );
	const settingsTabAnchorRef = useTourAnchor( 'site-settings-tab' );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const overviewDetails = useSiteOverviewDetails( site.id );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const [ activeTab, setActiveTab ] = useState< SiteOverviewTabId >( 'overview' );
	const managementActions = useSiteManagementActions( site, {
		onDelete: () => setDeleteOpen( true ),
	} );

	const busy = isStarting || isStopping;
	// Checkpoints run on the user's machine (the CLI checkpoint engine), so the
	// tab only exists where the connector can reach it.
	const supportsCheckpoints = useConnector().capabilities?.siteCheckpoints ?? false;
	const themeDetails = site.themeDetails;
	const isBlockTheme = themeDetails?.isBlockTheme === true;

	// Opens WordPress screens in the in-app preview panel (starting the site
	// first when needed) rather than the external browser.
	const openSiteUrl = useOpenSiteUrl( site );

	return (
		<div className={ styles.root }>
			<OverviewHeader site={ site } />
			<div className={ styles.tabsFrame }>
				<Tabs.Root
					selectedTabId={ activeTab }
					onSelect={ ( tabId ) => {
						if ( tabId && isSiteOverviewTab( tabId ) ) {
							setActiveTab( tabId );
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
													onClick={ () => void openSiteUrl( '/wp-admin/site-editor.php' ) }
												/>
												<OverviewButton
													icon={ <Icon icon={ stylesIcon } size={ 18 } /> }
													label={ __( 'Styles' ) }
													disabled={ busy }
													onClick={ () =>
														void openSiteUrl( '/wp-admin/site-editor.php?path=%2Fwp_global_styles' )
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ symbolFilled } size={ 18 } /> }
													label={ __( 'Patterns' ) }
													disabled={ busy }
													onClick={ () =>
														void openSiteUrl( '/wp-admin/site-editor.php?path=%2Fpatterns' )
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ navigation } size={ 18 } /> }
													label={ __( 'Navigation' ) }
													disabled={ busy }
													onClick={ () =>
														void openSiteUrl( '/wp-admin/site-editor.php?path=%2Fnavigation' )
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ layout } size={ 18 } /> }
													label={ __( 'Templates' ) }
													disabled={ busy }
													onClick={ () =>
														void openSiteUrl( '/wp-admin/site-editor.php?path=%2Fwp_template' )
													}
												/>
												<OverviewButton
													icon={ <Icon icon={ page } size={ 18 } /> }
													label={ __( 'Pages' ) }
													disabled={ busy }
													onClick={ () =>
														void openSiteUrl( '/wp-admin/site-editor.php?path=%2Fpage' )
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
													onClick={ () => void openSiteUrl( '/wp-admin/customize.php' ) }
												/>
												{ themeDetails?.supportsMenus ? (
													<OverviewButton
														icon={ <Icon icon={ navigation } size={ 18 } /> }
														label={ __( 'Menus' ) }
														disabled={ busy }
														onClick={ () => void openSiteUrl( '/wp-admin/nav-menus.php' ) }
													/>
												) : null }
												{ themeDetails?.supportsWidgets ? (
													<OverviewButton
														icon={ <Icon icon={ widget } size={ 18 } /> }
														label={ __( 'Widgets' ) }
														disabled={ busy }
														onClick={ () => void openSiteUrl( '/wp-admin/widgets.php' ) }
													/>
												) : null }
											</>
										) }
										<OverviewButton
											icon={ <Icon icon={ media } size={ 18 } /> }
											label={ __( 'Media Library' ) }
											disabled={ busy }
											onClick={ () => void openSiteUrl( '/wp-admin/upload.php' ) }
										/>
									</ButtonSection>

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
										onTabChange={ setActiveTab }
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
