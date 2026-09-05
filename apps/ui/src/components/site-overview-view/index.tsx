import {
	TRACKS_EVENTS,
	type TracksCustomizeEntryPoint,
} from '@studio/common/lib/record-tracks-event';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import {
	desktop,
	Icon,
	layout,
	media,
	navigation,
	page,
	pencil,
	post,
	styles as stylesIcon,
	symbolFilled,
	widget,
} from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useRef, useState } from 'react';
import { AgenticSigninBanner } from '@/components/agentic-signin-banner';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import {
	ImportSiteDialog,
	IMPORT_FILE_ACCEPT,
	useSiteBackupImport,
} from '@/components/import-site-dialog';
import { OfflineBanner } from '@/components/offline-banner';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { isSiteSettingsTab, SiteSettingsForm } from '@/components/site-settings-view';
import { SiteToolbar } from '@/components/site-toolbar';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { useIsSiteBusy, useSites } from '@/data/queries/use-sites';
import { useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { useThemeDetails } from '@/hooks/use-theme-details';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { AboutSection } from './about-section';
import { AdminSection } from './admin-section';
import { ConnectionsSection } from './connections-section';
import { OverviewCard } from './overview-card';
import { PreviewSitesSection } from './preview-sites-section';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

interface SiteOverviewViewProps {
	siteId: string;
	activeTab: SiteSettingsTabId;
	openSiteDropdown?: boolean;
	onTabChange: ( tab: SiteSettingsTabId ) => void;
}

interface OverviewButtonProps {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	loading?: boolean;
	loadingAnnouncement?: string;
	className?: string;
	brandIcon?: boolean;
	transitionName?: string;
}

function OverviewHeader( { site }: { site: SiteDetails } ) {
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
			<SiteToolbar site={ site } browserPath="/" />
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
	className,
	brandIcon,
	transitionName,
}: OverviewButtonProps ) {
	return (
		<Button
			variant="minimal"
			tone="neutral"
			className={ `${ styles.overviewButton } ${ className ?? '' }` }
			style={
				transitionName
					? { viewTransitionName: transitionName, viewTransitionClass: 'studio-theme-shortcut' }
					: undefined
			}
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

function ButtonSection( {
	title,
	loadingCount = 0,
	transitionName,
	children,
}: {
	title: string;
	loadingCount?: number;
	transitionName?: string;
	children: ReactNode;
} ) {
	return (
		<section
			className={ styles.buttonSection }
			style={ transitionName ? { viewTransitionName: transitionName } : undefined }
		>
			<h2 className={ styles.columnHeading }>{ title }</h2>
			<div className={ styles.buttonGrid } aria-busy={ loadingCount > 0 }>
				{ loadingCount > 0
					? Array.from( { length: loadingCount }, ( _, index ) => (
							<div key={ index } className={ styles.buttonSkeleton } aria-hidden="true" />
					  ) )
					: children }
			</div>
		</section>
	);
}

export function SiteOverviewView( { siteId, activeTab, onTabChange }: SiteOverviewViewProps ) {
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

	return <SiteOverviewBody site={ site } activeTab={ activeTab } onTabChange={ onTabChange } />;
}

function SiteOverviewBody( {
	site,
	activeTab,
	onTabChange,
}: {
	site: SiteDetails;
	activeTab: SiteSettingsTabId;
	onTabChange: ( tab: SiteSettingsTabId ) => void;
} ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const importInputRef = useRef< HTMLInputElement >( null );
	const backupImport = useSiteBackupImport( site );
	const managementActions = useSiteManagementActions( site, {
		onDelete: () => setDeleteOpen( true ),
		onImport: () => importInputRef.current?.click(),
	} );
	const themeStatus = useThemeDetails( site );
	const themeDetails = themeStatus.state === 'ready' ? themeStatus.details : undefined;
	const busy = useIsSiteBusy( site );
	const isBlockTheme = themeDetails?.isBlockTheme === true;
	const { data: wpVersion } = useWpVersion( site.id );

	// Opens WordPress screens in the in-app preview panel (starting the site
	// first when needed) rather than the external browser.
	const openSiteUrl = useOpenSiteUrl( site );

	const openCustomize = ( url: string, entryPoint: TracksCustomizeEntryPoint ) => {
		// The agentic UI opens customize screens in its in-app preview panel, not the OS browser.
		void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_CUSTOMIZE, {
			entry_point: entryPoint,
			browser: 'internal',
		} );
		void openSiteUrl( url );
	};

	return (
		<div className={ styles.root }>
			<OverviewHeader site={ site } />
			<div className={ styles.tabsFrame }>
				<Tabs.Root
					selectedTabId={ activeTab }
					onSelect={ ( tabId ) => {
						if ( tabId && isSiteSettingsTab( tabId ) ) {
							onTabChange( tabId );
						}
					} }
				>
					<div className={ styles.tabsBar }>
						<div className={ styles.tabsBarInner }>
							<Tabs.List>
								<Tabs.Tab tabId="overview">{ __( 'Overview' ) }</Tabs.Tab>
								<Tabs.Tab tabId="general">{ __( 'Settings' ) }</Tabs.Tab>
								<Tabs.Tab tabId="debugging">{ __( 'Debugging' ) }</Tabs.Tab>
							</Tabs.List>
						</div>
					</div>
					<div className={ styles.scroll }>
						<main className={ styles.content }>
							<Tabs.Panel tabId="overview" className={ styles.panel }>
								<OfflineBanner />
								<AgenticSigninBanner />
								<div className={ styles.cardColumn }>
									<h2 className={ styles.columnHeading }>{ __( 'About' ) }</h2>
									<OverviewCard>
										<AboutSection
											site={ site }
											wpVersion={ wpVersion }
											themeDetails={ themeDetails }
										/>
									</OverviewCard>
									<h2 className={ styles.columnHeading }>{ __( 'Connections' ) }</h2>
									<OverviewCard>
										<ConnectionsSection site={ site } busy={ busy } />
									</OverviewCard>
									<h2 className={ styles.columnHeading }>{ __( 'Preview sites' ) }</h2>
									<OverviewCard>
										<PreviewSitesSection site={ site } />
									</OverviewCard>
									<h2 className={ styles.columnHeading }>{ __( 'WP Admin' ) }</h2>
									<OverviewCard>
										<AdminSection site={ site } />
									</OverviewCard>
								</div>
								<div className={ styles.actionsColumn }>
									<ButtonSection
										title={ __( 'Shortcuts' ) }
										loadingCount={ themeStatus.state === 'loading' ? 7 : 0 }
										transitionName="studio-theme-shortcuts"
									>
										{ isBlockTheme ? (
											<>
												<OverviewButton
													transitionName="studio-theme-site-editor"
													icon={ <Icon icon={ desktop } size={ 18 } /> }
													label={ __( 'Site Editor' ) }
													disabled={ busy }
													onClick={ () => openCustomize( '/wp-admin/site-editor.php', 'editor' ) }
												/>
												<OverviewButton
													transitionName="studio-theme-styles"
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
													transitionName="studio-theme-patterns"
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
													transitionName="studio-theme-navigation"
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
													transitionName="studio-theme-templates"
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
											</>
										) : themeDetails ? (
											<>
												<OverviewButton
													transitionName="studio-theme-customizer"
													icon={ <Icon icon={ pencil } size={ 18 } /> }
													label={ __( 'Customizer' ) }
													disabled={ busy }
													onClick={ () => openCustomize( '/wp-admin/customize.php', 'customizer' ) }
												/>
												{ themeDetails?.supportsMenus ? (
													<OverviewButton
														transitionName="studio-theme-menus"
														icon={ <Icon icon={ navigation } size={ 18 } /> }
														label={ __( 'Menus' ) }
														disabled={ busy }
														onClick={ () => openCustomize( '/wp-admin/nav-menus.php', 'menus' ) }
													/>
												) : null }
												{ themeDetails?.supportsWidgets ? (
													<OverviewButton
														transitionName="studio-theme-widgets"
														icon={ <Icon icon={ widget } size={ 18 } /> }
														label={ __( 'Widgets' ) }
														disabled={ busy }
														onClick={ () => openCustomize( '/wp-admin/widgets.php', 'widgets' ) }
													/>
												) : null }
											</>
										) : null }
										<OverviewButton
											transitionName="studio-theme-posts"
											icon={ <Icon icon={ post } size={ 18 } /> }
											label={ __( 'Posts' ) }
											disabled={ busy }
											onClick={ () => void openSiteUrl( '/wp-admin/edit.php' ) }
										/>
										<OverviewButton
											transitionName="studio-theme-pages"
											icon={ <Icon icon={ page } size={ 18 } /> }
											label={ __( 'Pages' ) }
											disabled={ busy }
											onClick={ () => void openSiteUrl( '/wp-admin/edit.php?post_type=page' ) }
										/>
										<OverviewButton
											transitionName="studio-theme-media"
											icon={ <Icon icon={ media } size={ 18 } /> }
											label={ __( 'Media Library' ) }
											disabled={ busy }
											onClick={ () => openCustomize( '/wp-admin/upload.php', 'media_library' ) }
										/>
									</ButtonSection>

									<ButtonSection title={ __( 'Manage' ) } transitionName="studio-theme-manage">
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
							</Tabs.Panel>
							<SiteSettingsForm site={ site } activeTab={ activeTab } />
						</main>
					</div>
				</Tabs.Root>
			</div>
			<ProgressiveBlur direction="up" className={ styles.footerBlur } />
			<div className={ styles.footerBar }>
				<PreviewToggleButton />
			</div>
			<input
				ref={ importInputRef }
				type="file"
				hidden
				accept={ IMPORT_FILE_ACCEPT }
				data-testid="import-backup-file"
				onChange={ ( event ) => {
					backupImport.selectFile( event.target.files?.[ 0 ] );
					// Lets the same file be picked again after a cancel or a failure.
					event.target.value = '';
				} }
			/>
			<ImportSiteDialog
				site={ site }
				file={ backupImport.file }
				open={ backupImport.isConfirming }
				onCancel={ backupImport.cancel }
				onConfirm={ () => void backupImport.confirm() }
			/>
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ () => void navigate( { to: '/' } ) }
			/>
		</div>
	);
}
