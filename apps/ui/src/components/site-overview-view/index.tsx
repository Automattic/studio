import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import {
	copy,
	desktop,
	download,
	grid,
	Icon,
	layout,
	media,
	navigation,
	page,
	pencil,
	styles as stylesIcon,
	symbolFilled,
	trash,
	widget,
} from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { AgenticSigninBanner } from '@/components/agentic-signin-banner';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteHeaderActions } from '@/components/site-header-actions';
import { SiteSettingsForm, type SiteSettingsTabId } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOverviewDetails,
	useSites,
} from '@/data/queries/use-sites';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
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
	children: ReactNode;
}

type SiteOverviewTabId = 'overview' | SiteSettingsTabId;

function isSiteOverviewTab( value: string ): value is SiteOverviewTabId {
	return (
		value === 'overview' ||
		value === 'general' ||
		value === 'debugging' ||
		value === 'skills' ||
		value === 'instructions' ||
		value === 'checkpoints'
	);
}

// The settings-form tabs; checkpoints/skills/instructions render their own panels.
function isSettingsTab( value: SiteOverviewTabId ): value is SiteSettingsTabId {
	return (
		value === 'general' ||
		value === 'debugging' ||
		value === 'skills' ||
		value === 'instructions' ||
		value === 'checkpoints'
	);
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

function DetailSection( { title, children }: DetailSectionProps ) {
	return (
		<section className={ styles.detailSection }>
			<h2>{ title }</h2>
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
}: {
	details?: SiteOverviewDetails;
	isLoading: boolean;
	isError: boolean;
} ) {
	const status = getDetailsStatus( { isLoading, isError } );

	return (
		<div className={ styles.detailsColumn }>
			<DetailSection title={ __( 'Content' ) }>
				{ status ? (
					<p className={ styles.detailStatus }>{ status }</p>
				) : (
					<dl className={ styles.contentCounts }>
						<div className={ styles.contentCount }>
							<dt>{ __( 'Pages' ) }</dt>
							<dd>{ details?.content.pages ?? 0 }</dd>
						</div>
						<div className={ styles.contentCount }>
							<dt>{ __( 'Posts' ) }</dt>
							<dd>{ details?.content.posts ?? 0 }</dd>
						</div>
					</dl>
				) }
			</DetailSection>
			<ExtensionListSection
				title={ __( 'Plugins' ) }
				items={ details?.plugins }
				status={ status }
				emptyLabel={ __( 'No plugins installed.' ) }
			/>
			<ExtensionListSection
				title={ __( 'Themes' ) }
				items={ details?.themes }
				status={ status }
				emptyLabel={ __( 'No themes installed.' ) }
			/>
		</div>
	);
}

function ExtensionListSection( {
	title,
	items,
	status,
	emptyLabel,
}: {
	title: string;
	items?: SiteOverviewExtension[];
	status: string | null;
	emptyLabel: string;
} ) {
	return (
		<DetailSection title={ title }>
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
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const overviewDetails = useSiteOverviewDetails( site.id );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const [ activeTab, setActiveTab ] = useState< SiteOverviewTabId >( 'overview' );

	const busy = isStarting || isStopping;
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;
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
								<Tabs.Tab tabId="general">{ __( 'General' ) }</Tabs.Tab>
								<Tabs.Tab tabId="debugging">{ __( 'Debugging' ) }</Tabs.Tab>
								<Tabs.Tab tabId="skills">{ __( 'Skills' ) }</Tabs.Tab>
								<Tabs.Tab tabId="instructions">{ __( 'Instructions' ) }</Tabs.Tab>
								{ supportsCheckpoints ? (
									<Tabs.Tab tabId="checkpoints">{ __( 'Checkpoints' ) }</Tabs.Tab>
								) : null }
							</Tabs.List>
						</div>
					</div>
					<div className={ styles.scroll }>
						<main className={ styles.content }>
							<Tabs.Panel tabId="overview" className={ styles.panel }>
								<AgenticSigninBanner />
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
										<OverviewButton
											icon={ <Icon icon={ copy } size={ 18 } /> }
											label={ __( 'Duplicate' ) }
											loading={ copySite.isPending }
											loadingAnnouncement={ __( 'Duplicating site' ) }
											disabled={ copySite.isPending }
											onClick={ () => copySite.mutate( site.id ) }
										/>
										<OverviewButton
											icon={ <Icon icon={ download } size={ 18 } /> }
											label={ __( 'Export' ) }
											loading={ exportFullSite.isPending }
											loadingAnnouncement={ __( 'Exporting site' ) }
											disabled={ isExporting }
											onClick={ () => exportFullSite.mutate( site.id ) }
										/>
										<OverviewButton
											icon={ <Icon icon={ grid } size={ 18 } /> }
											label={ __( 'Export DB' ) }
											loading={ exportDatabase.isPending }
											loadingAnnouncement={ __( 'Exporting database' ) }
											disabled={ isExporting }
											onClick={ () => exportDatabase.mutate( site.id ) }
										/>
										<OverviewButton
											icon={ <Icon icon={ trash } size={ 18 } /> }
											label={ __( 'Delete' ) }
											className={ styles.destructiveButton }
											onClick={ () => setDeleteOpen( true ) }
										/>
									</ButtonSection>
								</div>
								<OverviewDetailsSections
									details={ overviewDetails.data }
									isLoading={ overviewDetails.isLoading }
									isError={ overviewDetails.isError }
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
