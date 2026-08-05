import { getSiteRuntime, SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon, page } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { AgenticSigninBanner } from '@/components/agentic-signin-banner';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import { OfflineBanner } from '@/components/offline-banner';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { PreviewToggleButton } from '@/components/preview-toggle-button';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { DATABASE_HOME_PATH } from '@/components/site-preview/address-bar';
import { SiteSettingsForm } from '@/components/site-settings-view';
import * as Tabs from '@/components/tabs';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useIsSiteStopping, useSites } from '@/data/queries/use-sites';
import { useThemeDetails } from '@/data/queries/use-theme-details';
import { useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useCustomizeLinks } from '@/hooks/use-customize-links';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import { databaseIcon } from '@/lib/icons';
import { ConnectionsTab } from './connections-tab';
import styles from './style.module.css';
import type { SiteWorkspaceTabId } from '@/components/site-workspace-shell';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

type SiteOverviewTabId = Exclude< SiteWorkspaceTabId, 'chat' >;

interface SiteOverviewViewProps {
	siteId: string;
	activeTab: SiteOverviewTabId;
}

function OverviewButton( {
	icon,
	label,
	onClick,
	disabled,
	loading,
	loadingAnnouncement,
	destructive,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	loading?: boolean;
	loadingAnnouncement?: string;
	destructive?: boolean;
} ) {
	return (
		<Button
			variant="minimal"
			tone="neutral"
			className={ `${ styles.overviewButton } ${ destructive ? styles.destructiveButton : '' }` }
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

function SummaryItem( { label, value }: { label: string; value: ReactNode } ) {
	return (
		<div className={ styles.summaryItem }>
			<dt>{ label }</dt>
			<dd>{ value }</dd>
		</div>
	);
}

function formatDate( value?: string | null ): string {
	if ( ! value ) {
		return '—';
	}
	const date = new Date( value );
	return Number.isNaN( date.getTime() )
		? '—'
		: new Intl.DateTimeFormat( undefined, { dateStyle: 'medium' } ).format( date );
}

function ThemeSummary( { theme }: { theme: SiteDetails[ 'themeDetails' ] } ) {
	const connector = useConnector();

	return (
		<section className={ styles.summaryCard } aria-labelledby="overview-theme-heading">
			<h2 id="overview-theme-heading">{ __( 'Theme' ) }</h2>
			<div className={ styles.summaryTop }>
				<strong className={ styles.themeName }>{ theme?.name ?? __( 'Theme unavailable' ) }</strong>
				{ theme ? (
					<span className={ styles.themePill }>
						{ theme.isBlockTheme ? __( 'Block theme' ) : __( 'Classic theme' ) }
					</span>
				) : null }
			</div>
			<dl className={ styles.summaryList }>
				<SummaryItem label={ __( 'Version' ) } value={ theme?.version || '—' } />
				<SummaryItem
					label={ __( 'Templates' ) }
					value={ theme?.isBlockTheme ? theme.templateCount ?? '—' : '—' }
				/>
				<SummaryItem label={ __( 'Patterns' ) } value={ theme?.patternCount ?? '—' } />
				<SummaryItem label={ __( 'Updated' ) } value={ formatDate( theme?.modifiedAt ) } />
			</dl>
			{ theme?.homepage ? (
				<Button
					variant="minimal"
					tone="neutral"
					size="compact"
					className={ styles.summaryLink }
					onClick={ () => void connector.openExternalUrl( theme.homepage! ) }
				>
					{ __( 'Theme homepage' ) }
				</Button>
			) : null }
		</section>
	);
}

function EnvironmentSummary( { site, wpVersion }: { site: SiteDetails; wpVersion?: string } ) {
	const runtime = getSiteRuntime( site );

	return (
		<section className={ styles.summaryCard } aria-labelledby="overview-environment-heading">
			<h2 id="overview-environment-heading">{ __( 'Environment' ) }</h2>
			<dl className={ styles.summaryList }>
				<SummaryItem
					label={ __( 'WordPress' ) }
					value={ wpVersion && wpVersion !== '-' ? wpVersion : '—' }
				/>
				<SummaryItem label={ __( 'PHP' ) } value={ site.phpVersion } />
				<SummaryItem
					label={ __( 'Runtime' ) }
					value={ runtime === SITE_RUNTIME_PLAYGROUND ? __( 'Sandbox' ) : __( 'Native PHP' ) }
				/>
				<SummaryItem label={ __( 'Database' ) } value={ __( 'SQLite' ) } />
				<SummaryItem
					label={ __( 'HTTPS' ) }
					value={ site.enableHttps ? __( 'On' ) : __( 'Off' ) }
				/>
				<SummaryItem
					label={ __( 'Auto-updates' ) }
					value={ site.isWpAutoUpdating === false ? __( 'Off' ) : __( 'On' ) }
				/>
			</dl>
		</section>
	);
}

function OverviewConnections( { site }: { site: SiteDetails } ) {
	return (
		<section
			className={ `${ styles.summaryCard } ${ styles.connectionsSummary }` }
			aria-labelledby="overview-connections-heading"
		>
			<h2 id="overview-connections-heading">{ __( 'Connections' ) }</h2>
			<ConnectionsTab site={ site } compact />
		</section>
	);
}

function ButtonSection( { title, children }: { title: string; children: ReactNode } ) {
	return (
		<section className={ styles.buttonSection }>
			<h2>{ title }</h2>
			<div className={ styles.buttonGrid }>{ children }</div>
		</section>
	);
}

function Overview( { site }: { site: SiteDetails } ) {
	const navigate = useNavigate();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const { data: theme } = useThemeDetails( site );
	const { data: wpVersion } = useWpVersion( site.id );
	const siteWithTheme = theme ? { ...site, themeDetails: theme } : site;
	const managementActions = useSiteManagementActions( site, {
		onDelete: () => setDeleteOpen( true ),
	} );
	const { customizeLinks } = useCustomizeLinks( siteWithTheme );
	const openSiteUrl = useOpenSiteUrl( site );
	const openInDestinations = useOpenInDestinations( site, '/' );
	const overviewCustomizeLinks = theme?.isBlockTheme
		? [
				...customizeLinks,
				{
					id: 'pages',
					icon: page,
					label: __( 'Pages' ),
					url: '/wp-admin/site-editor.php?path=%2Fpage',
				},
		  ]
		: customizeLinks;
	const busy = isStarting || isStopping;

	return (
		<>
			<OfflineBanner />
			<AgenticSigninBanner />
			<div className={ styles.actionsColumn }>
				<div className={ styles.summaryGrid }>
					<ThemeSummary theme={ theme } />
					<EnvironmentSummary site={ site } wpVersion={ wpVersion } />
					<OverviewConnections site={ site } />
				</div>
				<ButtonSection title={ __( 'Customize' ) }>
					{ overviewCustomizeLinks.map( ( link ) => (
						<OverviewButton
							key={ link.id }
							icon={ <Icon icon={ link.icon } size={ 18 } /> }
							label={ link.label }
							disabled={ busy }
							onClick={ () => void openSiteUrl( link.url ) }
						/>
					) ) }
				</ButtonSection>
				<ButtonSection title={ __( 'Open in…' ) }>
					{ openInDestinations.map( ( destination ) => (
						<OverviewButton
							key={ destination.id }
							icon={ destination.logo }
							label={ destination.label }
							disabled={ destination.disabled }
							onClick={ destination.open }
						/>
					) ) }
					<OverviewButton
						icon={ databaseIcon }
						label={ __( 'phpMyAdmin' ) }
						disabled={ busy }
						onClick={ () => void openSiteUrl( DATABASE_HOME_PATH ) }
					/>
				</ButtonSection>
				<ButtonSection title={ __( 'Manage' ) }>
					{ managementActions.map( ( action ) => (
						<OverviewButton
							key={ action.id }
							icon={ <Icon icon={ action.icon } size={ 18 } /> }
							label={ action.label }
							disabled={ action.disabled }
							loading={ action.loading }
							loadingAnnouncement={ action.loadingAnnouncement }
							destructive={ action.destructive }
							onClick={ action.run }
						/>
					) ) }
				</ButtonSection>
			</div>
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ () => void navigate( { to: '/' } ) }
			/>
		</>
	);
}

export function SiteOverviewView( { siteId, activeTab }: SiteOverviewViewProps ) {
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

	return <SiteWorkspaceContent site={ site } activeTab={ activeTab } />;
}

function SiteWorkspaceContent( {
	site,
	activeTab,
}: {
	site: SiteDetails;
	activeTab: SiteOverviewTabId;
} ) {
	return (
		<div className={ styles.root }>
			<div className={ styles.tabsFrame }>
				<div className={ styles.scroll }>
					<main className={ styles.content }>
						<Tabs.Panel tabId="overview" className={ styles.panel }>
							{ activeTab === 'overview' ? <Overview site={ site } /> : null }
						</Tabs.Panel>
						{ /* Fetches on mount, so it's built only once opened. */ }
						<Tabs.Panel tabId="connections" className={ styles.panel }>
							{ activeTab === 'connections' ? <ConnectionsTab site={ site } /> : null }
						</Tabs.Panel>
						<SiteSettingsForm site={ site } />
					</main>
				</div>
			</div>
			<ProgressiveBlur direction="up" className={ styles.footerBlur } />
			<div className={ styles.footerBar }>
				<PreviewToggleButton />
			</div>
		</div>
	);
}
