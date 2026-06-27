import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import {
	archive,
	code,
	copy,
	desktop,
	download,
	grid,
	Icon,
	layout,
	navigation,
	page,
	pencil,
	preformatted,
	styles as stylesIcon,
	symbolFilled,
	trash,
	widget,
} from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import { SiteDropdown } from '@/components/site-dropdown';
import { SiteSettingsForm, type SiteSettingsTabId } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
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

type SiteOverviewTabId = 'overview' | SiteSettingsTabId;

function isSiteOverviewTab( value: string ): value is SiteOverviewTabId {
	return value === 'overview' || value === 'general' || value === 'debugging';
}

function isSettingsTab( value: SiteOverviewTabId ): value is SiteSettingsTabId {
	return value === 'general' || value === 'debugging';
}

function OverviewHeader( { site }: { site: SiteDetails } ) {
	const sidebarCollapsed = useSidebarCollapsed();

	return (
		<div
			className={
				sidebarCollapsed ? `${ styles.header } ${ styles.headerSidebarCollapsed }` : styles.header
			}
		>
			<SiteDropdown site={ site } showStatus={ sidebarCollapsed } />
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

function getFileManagerLabel() {
	const platform = navigator.platform.toLowerCase();
	if ( platform.includes( 'win' ) ) {
		return __( 'File Explorer' );
	}
	if ( platform.includes( 'linux' ) ) {
		return __( 'File manager' );
	}
	return __( 'Finder' );
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
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: userPreferences } = useUserPreferences();
	const startSite = useStartSite();
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const [ activeTab, setActiveTab ] = useState< SiteOverviewTabId >( 'overview' );

	const busy = isStarting || isStopping;
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;
	const editorLabel = userPreferences?.editor
		? supportedEditorConfig[ userPreferences.editor ].label
		: __( 'Editor' );
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name
		: __( 'Terminal' );
	const themeDetails = site.themeDetails;
	const isBlockTheme = themeDetails?.isBlockTheme === true;

	const ensureRunning = async () => {
		if ( site.running ) {
			return true;
		}
		try {
			await startSite.mutateAsync( site.id );
			return true;
		} catch {
			return false;
		}
	};

	const openSiteUrl = async ( relativeUrl = '', options?: { autoLogin?: boolean } ) => {
		if ( ! ( await ensureRunning() ) ) {
			return;
		}
		void connector.openSiteUrl( site.id, relativeUrl, options ).catch( ( error ) => {
			console.error( 'Failed to open site URL:', error );
		} );
	};

	const openFolder = () => {
		void connector.openSiteFolder( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site folder:', error );
		} );
	};

	const openEditor = () => {
		if ( ! userPreferences?.editor ) {
			void navigate( { to: '/settings' } );
			return;
		}
		void connector.openSiteInEditor( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in editor:', error );
		} );
	};

	const openTerminal = () => {
		void connector.openSiteInTerminal( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in terminal:', error );
		} );
	};

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
							</Tabs.List>
						</div>
					</div>
					<div className={ styles.scroll }>
						<main className={ styles.content }>
							<Tabs.Panel tabId="overview" className={ styles.panel }>
								<div className={ styles.actionsColumn }>
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
									</ButtonSection>

									<ButtonSection title={ __( 'Open in…' ) }>
										<OverviewButton
											icon={ <Icon icon={ archive } size={ 18 } /> }
											label={ getFileManagerLabel() }
											onClick={ openFolder }
										/>
										<OverviewButton
											icon={ <Icon icon={ code } size={ 18 } /> }
											label={ editorLabel }
											onClick={ openEditor }
										/>
										<OverviewButton
											icon={ <Icon icon={ preformatted } size={ 18 } /> }
											label={ terminalLabel }
											onClick={ openTerminal }
										/>
										<OverviewButton
											icon={ <Icon icon={ grid } size={ 18 } /> }
											label={ __( 'phpMyAdmin' ) }
											disabled={ busy }
											onClick={ () =>
												void openSiteUrl(
													'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
												)
											}
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
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ () => void navigate( { to: '/' } ) }
			/>
		</div>
	);
}
