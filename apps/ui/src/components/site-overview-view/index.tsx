import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import {
	desktop,
	grid,
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
import { clsx } from 'clsx';
import { useState } from 'react';
import { AgenticSigninBanner } from '@/components/agentic-signin-banner';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import { OfflineBanner } from '@/components/offline-banner';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { DATABASE_HOME_PATH } from '@/components/site-preview/address-bar';
import { isSiteSettingsTab, SiteSettingsForm } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useIsSiteStopping, useSites } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { useThemeDetails } from '@/hooks/use-theme-details';
import { useTrafficLightSpace } from '@/hooks/use-traffic-light-space';
import { AboutSection } from './about-section';
import { ConnectionsSection } from './connections-section';
import { CardSectionDivider, OverviewCard } from './overview-card';
import { PreviewSitesSection } from './preview-sites-section';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
import type { SiteDetails } from '@/data/core';
import type { ThemeDetailsStatus } from '@/hooks/use-theme-details';
import type { ReactElement, ReactNode, SVGProps } from 'react';

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
	// Brand marks bring their own fills; see `.brandIcon` in the stylesheet.
	brandIcon?: boolean;
}

// A WP Admin destination offered under "Customize". Which ones a site gets
// depends on its active theme.
interface CustomizeShortcut {
	id: string;
	// Matches the element type `Icon` accepts, so shortcuts render via
	// `<Icon icon={ shortcut.icon } />` without widening casts.
	icon: ReactElement< SVGProps< SVGSVGElement > >;
	label: string;
	url: string;
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
			className={ clsx( styles.overviewButton, className ) }
			disabled={ disabled }
			loading={ loading }
			loadingAnnouncement={ loadingAnnouncement }
			onClick={ onClick }
		>
			<span
				className={ clsx( styles.overviewButtonIcon, brandIcon && styles.brandIcon ) }
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
	busy,
	children,
}: {
	title: string;
	busy?: boolean;
	children: ReactNode;
} ) {
	return (
		<section className={ styles.buttonSection }>
			<h2>{ title }</h2>
			<div className={ styles.buttonGrid } aria-busy={ busy }>
				{ children }
			</div>
		</section>
	);
}

function ButtonPlaceholders( { count }: { count: number } ) {
	return Array.from( { length: count }, ( _, index ) => (
		<div key={ index } className={ styles.buttonSkeleton } />
	) );
}

function customizeShortcuts( status: ThemeDetailsStatus ): CustomizeShortcut[] {
	const details = status.state === 'ready' ? status.details : undefined;
	// A theme the host can't report is treated as a block theme: every default
	// WordPress theme since Twenty Twenty-Two is one, and guessing "classic"
	// hides the Site Editor entirely.
	const isBlockTheme = details ? details.isBlockTheme : true;

	const themeShortcuts: CustomizeShortcut[] = isBlockTheme
		? [
				{
					id: 'site-editor',
					icon: desktop,
					label: __( 'Site Editor' ),
					url: '/wp-admin/site-editor.php',
				},
				{
					id: 'styles',
					icon: stylesIcon,
					label: __( 'Styles' ),
					url: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
				},
				{
					id: 'patterns',
					icon: symbolFilled,
					label: __( 'Patterns' ),
					url: '/wp-admin/site-editor.php?path=%2Fpatterns',
				},
				{
					id: 'navigation',
					icon: navigation,
					label: __( 'Navigation' ),
					url: '/wp-admin/site-editor.php?path=%2Fnavigation',
				},
				{
					id: 'templates',
					icon: layout,
					label: __( 'Templates' ),
					url: '/wp-admin/site-editor.php?path=%2Fwp_template',
				},
				{
					id: 'pages',
					icon: page,
					label: __( 'Pages' ),
					url: '/wp-admin/site-editor.php?path=%2Fpage',
				},
		  ]
		: [
				{
					id: 'customizer',
					icon: pencil,
					label: __( 'Customizer' ),
					url: '/wp-admin/customize.php',
				},
				...( details?.supportsMenus
					? [
							{
								id: 'menus',
								icon: navigation,
								label: __( 'Menus' ),
								url: '/wp-admin/nav-menus.php',
							},
					  ]
					: [] ),
				...( details?.supportsWidgets
					? [
							{
								id: 'widgets',
								icon: widget,
								label: __( 'Widgets' ),
								url: '/wp-admin/widgets.php',
							},
					  ]
					: [] ),
		  ];

	return [
		...themeShortcuts,
		{
			id: 'media',
			icon: media,
			label: __( 'Media Library' ),
			url: '/wp-admin/upload.php',
		},
	];
}

function CustomizeSection( {
	themeStatus,
	busy,
	openSiteUrl,
}: {
	themeStatus: ThemeDetailsStatus;
	busy: boolean;
	openSiteUrl: ( url: string ) => Promise< void >;
} ) {
	const loading = themeStatus.state === 'loading';

	return (
		<ButtonSection title={ __( 'Customize' ) } busy={ loading }>
			{ loading ? (
				<ButtonPlaceholders count={ 7 } />
			) : (
				customizeShortcuts( themeStatus ).map( ( shortcut ) => (
					<OverviewButton
						key={ shortcut.id }
						icon={ <Icon icon={ shortcut.icon } size={ 18 } /> }
						label={ shortcut.label }
						disabled={ busy }
						onClick={ () => void openSiteUrl( shortcut.url ) }
					/>
				) )
			) }
		</ButtonSection>
	);
}

/**
 * The apps a site can be handed off to. Mirrors the preview toolbar's
 * "Open in…" menu, minus the browser (the preview itself is the browser here)
 * and plus phpMyAdmin, which the classic overview also grouped with them.
 */
function OpenInSection( {
	site,
	busy,
	openSiteUrl,
}: {
	site: SiteDetails;
	busy: boolean;
	openSiteUrl: ( url: string ) => Promise< void >;
} ) {
	const { data: preferences } = useUserPreferences();
	// The browser destination is filtered out below, so its path is irrelevant.
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
				icon={ <Icon icon={ grid } size={ 18 } /> }
				label={ __( 'phpMyAdmin' ) }
				disabled={ busy }
				onClick={ () => void openSiteUrl( DATABASE_HOME_PATH ) }
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
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const managementActions = useSiteManagementActions( site, {
		onDelete: () => setDeleteOpen( true ),
	} );

	const busy = isStarting || isStopping;
	const themeStatus = useThemeDetails( site );
	const { data: wpVersion } = useWpVersion( site.id );

	// Opens WordPress screens in the in-app preview panel (starting the site
	// first when needed) rather than the external browser.
	const openSiteUrl = useOpenSiteUrl( site );

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
								<div className={ styles.overviewLayout }>
									<div className={ styles.cardColumn }>
										<OverviewCard>
											<AboutSection
												site={ site }
												themeStatus={ themeStatus }
												wpVersion={ wpVersion }
											/>
											<CardSectionDivider />
											<ConnectionsSection site={ site } busy={ busy } />
											<CardSectionDivider />
											<PreviewSitesSection site={ site } />
										</OverviewCard>
									</div>
									<div className={ styles.actionsColumn }>
										<CustomizeSection
											themeStatus={ themeStatus }
											busy={ busy }
											openSiteUrl={ openSiteUrl }
										/>

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
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ () => void navigate( { to: '/' } ) }
			/>
		</div>
	);
}
