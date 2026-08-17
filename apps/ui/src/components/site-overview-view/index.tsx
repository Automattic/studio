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
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { DATABASE_HOME_PATH } from '@/components/site-preview/address-bar';
import { isSiteSettingsTab, SiteSettingsForm } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { useIsSiteBusy, useSites } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { databaseLogo } from '@/lib/logos';
import { AboutSection } from './about-section';
import { AdminSection } from './admin-section';
import { OverviewCard } from './overview-card';
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
}: OverviewButtonProps ) {
	return (
		<Button
			variant="minimal"
			tone="neutral"
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

function ButtonSection( { title, children }: { title: string; children: ReactNode } ) {
	return (
		<section className={ styles.buttonSection }>
			<h2 className={ styles.columnHeading }>{ title }</h2>
			<div className={ styles.buttonGrid }>{ children }</div>
		</section>
	);
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
	const destinations = useOpenInDestinations( site, '/' );
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
					// Opens in the in-app preview panel, not the OS browser.
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
	activeTab,
	openSiteDropdown = false,
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
			activeTab={ activeTab }
			openSiteDropdown={ openSiteDropdown }
			onTabChange={ onTabChange }
		/>
	);
}

function SiteOverviewBody( {
	site,
	activeTab,
	openSiteDropdown,
	onTabChange,
}: {
	site: SiteDetails;
	activeTab: SiteSettingsTabId;
	openSiteDropdown: boolean;
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

	const busy = useIsSiteBusy( site );
	const themeDetails = site.themeDetails;
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
			<OverviewHeader site={ site } openSiteDropdown={ openSiteDropdown } />
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
										<AboutSection site={ site } wpVersion={ wpVersion } />
									</OverviewCard>
									<h2 className={ styles.columnHeading }>{ __( 'WP Admin' ) }</h2>
									<OverviewCard>
										<AdminSection site={ site } />
									</OverviewCard>
								</div>
								<div className={ styles.actionsColumn }>
									<ButtonSection title={ __( 'Customize' ) }>
										{ isBlockTheme ? (
											<>
												<OverviewButton
													icon={ <Icon icon={ desktop } size={ 18 } /> }
													label={ __( 'Site Editor' ) }
													disabled={ busy }
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

									{ connector.capabilities.openInOS && (
										<OpenInSection site={ site } busy={ busy } openSiteUrl={ openSiteUrl } />
									) }

									<ButtonSection title={ __( 'Manage' ) }>
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
