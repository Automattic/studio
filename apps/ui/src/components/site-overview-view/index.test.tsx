import { DEFAULT_ACTIVITY_SOUND_PREFERENCES } from '@studio/common/lib/activity-sounds';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useCertificateTrust, useTrustCertificate } from '@/data/queries/use-certificate-trust';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOverviewDetails,
	useSites,
	useStartSite,
	useStopSite,
	useUpdateSite,
	useXdebugEnabledSite,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';
import { SiteOverviewView } from './index';
import type { SiteDetails } from '@/data/core';

const navigateMock = vi.fn();
const siteDropdownMock = vi.hoisted( () => vi.fn() );
const headerActionsMock = vi.hoisted( () => vi.fn() );
const useSidebarCollapsedMock = vi.hoisted( () => vi.fn() );
const useTrafficLightSpaceMock = vi.hoisted( () => vi.fn() );

class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigateMock,
} ) );

vi.mock( '@/components/delete-site-dialog', () => ( {
	DeleteSiteDialog: ( { open }: { open: boolean } ) =>
		open ? <div role="dialog">Delete dialog</div> : null,
} ) );

// Canvas-backed W background; jsdom has no 2D context, so stub it out.
vi.mock( '@/ui-classic/components/session-view/empty-background', () => ( {
	EmptyBackground: () => null,
} ) );

// Canvas-backed dot-grid backdrop; jsdom has no 2D context, so stub it out.
vi.mock( '@/components/dot-grid', () => ( {
	DotGrid: () => null,
} ) );

vi.mock( '@/components/site-header-actions', () => ( {
	SiteHeaderActions: ( props: { site: SiteDetails } ) => {
		headerActionsMock( props );
		return <button type="button">Open in…</button>;
	},
} ) );

vi.mock( '@/components/site-dropdown', () => ( {
	SiteDropdown: ( props: { site: SiteDetails; showSiteIcon?: boolean; showStatus?: boolean } ) => {
		siteDropdownMock( props );
		return <div>{ props.site.name }</div>;
	},
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useLogin: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useCopySite: vi.fn(),
	useExportDatabase: vi.fn(),
	useExportFullSite: vi.fn(),
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useSiteOverviewDetails: vi.fn(),
	useSites: vi.fn(),
	useStartSite: vi.fn(),
	useStopSite: vi.fn(),
	useUpdateSite: vi.fn(),
	useXdebugEnabledSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-certificate-trust', () => ( {
	useCertificateTrust: vi.fn(),
	useTrustCertificate: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
	useWpVersion: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

vi.mock( '@/hooks/use-fullscreen', () => ( {
	useFullscreen: () => false,
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: useSidebarCollapsedMock,
} ) );

vi.mock( '@/hooks/use-traffic-light-space', () => ( {
	useTrafficLightSpace: useTrafficLightSpaceMock,
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useAgenticFeaturesMock = vi.mocked( useAgenticFeatures );
const useLoginMock = vi.mocked( useLogin, { partial: true } );
const useExistingCustomDomainsMock = vi.mocked( useExistingCustomDomains, { partial: true } );
const useCopySiteMock = vi.mocked( useCopySite, { partial: true } );
const useExportDatabaseMock = vi.mocked( useExportDatabase, { partial: true } );
const useExportFullSiteMock = vi.mocked( useExportFullSite, { partial: true } );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useSiteOverviewDetailsMock = vi.mocked( useSiteOverviewDetails, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );
const useStopSiteMock = vi.mocked( useStopSite, { partial: true } );
const useUpdateSiteMock = vi.mocked( useUpdateSite, { partial: true } );
const useXdebugEnabledSiteMock = vi.mocked( useXdebugEnabledSite, { partial: true } );
const useUserPreferencesMock = vi.mocked( useUserPreferences, { partial: true } );
const useCertificateTrustMock = vi.mocked( useCertificateTrust, { partial: true } );
const useTrustCertificateMock = vi.mocked( useTrustCertificate, { partial: true } );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );
const useWpVersionMock = vi.mocked( useWpVersion, { partial: true } );
const useOfflineMock = vi.mocked( useOffline );

describe( 'SiteOverviewView', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const openSiteFolder = vi.fn().mockResolvedValue( undefined );
	const openSiteInEditor = vi.fn().mockResolvedValue( undefined );
	const openSiteInTerminal = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );
	const stopSite = vi.fn();
	const copySite = vi.fn();
	const exportFullSite = vi.fn();
	const exportDatabase = vi.fn();
	const updateSite = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		siteDropdownMock.mockClear();
		useSidebarCollapsedMock.mockReturnValue( false );
		useTrafficLightSpaceMock.mockReturnValue( { start: false, end: false } );
		vi.stubGlobal( 'ResizeObserver', ResizeObserverMock );
		Object.defineProperty( window, 'matchMedia', {
			writable: true,
			value: vi.fn().mockImplementation( ( query: string ) => ( {
				matches: false,
				media: query,
				onchange: null,
				addListener: vi.fn(),
				removeListener: vi.fn(),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
			} ) ),
		} );

		useConnectorMock.mockReturnValue( {
			openSiteUrl,
			openSiteFolder,
			openSiteInEditor,
			openSiteInTerminal,
		} );
		useAgenticFeaturesMock.mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			reason: null,
			isReady: true,
		} );
		useLoginMock.mockReturnValue( { isPending: false, mutate: vi.fn() } );
		useSitesMock.mockReturnValue( {
			data: [ createSite( { running: true } ) ],
			isLoading: false,
		} );
		useExistingCustomDomainsMock.mockReturnValue( [] );
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate: updateSite } );
		useXdebugEnabledSiteMock.mockReturnValue( null );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useStartSiteMock.mockReturnValue( {
			isPending: false,
			mutate: startSite,
			mutateAsync: startSite,
		} );
		useStopSiteMock.mockReturnValue( { isPending: false, mutate: stopSite } );
		useCopySiteMock.mockReturnValue( { isPending: false, mutate: copySite } );
		useExportFullSiteMock.mockReturnValue( { isPending: false, mutate: exportFullSite } );
		useExportDatabaseMock.mockReturnValue( { isPending: false, mutate: exportDatabase } );
		useSiteOverviewDetailsMock.mockReturnValue( {
			data: {
				plugins: [
					{
						slug: 'akismet/akismet.php',
						name: 'Akismet Anti-spam',
						status: 'active',
						version: '5.3',
					},
					{
						slug: 'hello.php',
						name: 'Hello Dolly',
						status: 'inactive',
						version: '1.7.2',
					},
				],
				themes: [
					{
						slug: 'twentytwentysix',
						name: 'Twenty Twenty-Six',
						status: 'active',
						version: '1.0',
					},
					{
						slug: 'twentytwentyfive',
						name: 'Twenty Twenty-Five',
						status: 'inactive',
						version: '1.2',
					},
				],
			},
			isLoading: false,
			isError: false,
		} );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: 'zed',
				terminal: 'terminal',
				colorScheme: 'system',
				frameColor: null,
				locale: undefined,
				analyticsEnabled: true,
				defaultSiteDirectory: '/Users/example/Studio',
				studioCliInstalled: false,
				studioCliExternallyManaged: false,
				agenticFeaturesEnabled: true,
				chatNotificationsEnabled: true,
				activitySoundPreferences: DEFAULT_ACTIVITY_SOUND_PREFERENCES,
				quitSitesBehavior: 'ask',
				agentResponseLength: 'normal',
				toolPermissions: {},
				defaultAiModel: 'claude-sonnet-5',
			},
		} );
		useCertificateTrustMock.mockReturnValue( { data: true } );
		useTrustCertificateMock.mockReturnValue( { mutate: vi.fn() } );
		useWordPressVersionsMock.mockReturnValue( { data: [] } );
		useWpVersionMock.mockReturnValue( { data: undefined } );
		useOfflineMock.mockReturnValue( false );
	} );

	it( 'renders the shortcut sections', async () => {
		render( <SiteOverviewView siteId="site-1" /> );

		expect( siteDropdownMock ).toHaveBeenCalledWith(
			expect.objectContaining( {
				showSiteIcon: true,
				showStatus: false,
			} )
		);
		expect( screen.getByRole( 'tab', { name: 'Overview' } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Chats' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'tab', { name: 'Settings' } ) ).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Agent' } ) ).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'General' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Debugging' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Skills' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab', { name: 'Instructions' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Active chats' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Archived chats' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'heading', { name: 'Theme' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Customize' } ) ).toBeVisible();
		expect( screen.queryByRole( 'heading', { name: 'Open in…' } ) ).not.toBeInTheDocument();
		expect( headerActionsMock ).toHaveBeenCalledWith(
			expect.objectContaining( { site: expect.objectContaining( { id: 'site-1' } ) } )
		);
		expect( screen.getByRole( 'heading', { name: 'Manage' } ) ).toBeVisible();
		expect( screen.queryByRole( 'heading', { name: 'Content' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'heading', { name: 'Plugins' } ) ).toBeVisible();
		expect( screen.getByRole( 'heading', { name: 'Themes' } ) ).toBeVisible();
		expect( screen.getByText( 'Site Editor' ) ).toBeVisible();
		expect( screen.getByText( 'Media Library' ) ).toBeVisible();
		expect( screen.getByText( 'Akismet Anti-spam' ) ).toBeVisible();
		expect( screen.getByText( 'Version 5.3 | Active' ) ).toBeVisible();
		expect( screen.getByText( 'Hello Dolly' ) ).toBeVisible();
		expect( screen.getByText( 'Twenty Twenty-Six' ) ).toBeVisible();
		expect( screen.getByText( 'Twenty Twenty-Five' ) ).toBeVisible();
		expect( screen.queryByDisplayValue( 'Demo Site' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Settings' } ) );

		expect( screen.getByDisplayValue( 'Demo Site' ) ).toBeVisible();
		expect( screen.queryByText( 'Site settings' ) ).not.toBeInTheDocument();
	} );

	it( 'offsets the site menu below macOS traffic lights when the sidebar is collapsed', () => {
		useSidebarCollapsedMock.mockReturnValue( true );
		useTrafficLightSpaceMock.mockReturnValue( { start: true, end: false } );

		render( <SiteOverviewView siteId="site-1" /> );

		expect( screen.getByText( 'Demo Site' ).parentElement ).toHaveClass(
			styles.headerSidebarCollapsed
		);
	} );

	it( 'hides the sign-in banner while agentic features are available', () => {
		render( <SiteOverviewView siteId="site-1" /> );

		expect(
			screen.queryByRole( 'heading', { name: 'Let Studio code it for you' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows a sign-in banner with a login action when signed out', () => {
		const loginMutate = vi.fn();
		useAgenticFeaturesMock.mockReturnValue( {
			enabled: false,
			chatEnabled: false,
			reason: 'signed-out',
			isReady: true,
		} );
		useLoginMock.mockReturnValue( { isPending: false, mutate: loginMutate } );

		render(
			<Tooltip.Provider>
				<SiteOverviewView siteId="site-1" />
			</Tooltip.Provider>
		);

		expect( screen.getByRole( 'heading', { name: 'Let Studio code it for you' } ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( loginMutate ).toHaveBeenCalled();
	} );

	it( 'hides the sign-in banner when agentic features are disabled by preference', () => {
		useAgenticFeaturesMock.mockReturnValue( {
			enabled: true,
			chatEnabled: false,
			reason: null,
			isReady: true,
		} );

		render( <SiteOverviewView siteId="site-1" /> );

		expect(
			screen.queryByRole( 'heading', { name: 'Let Studio code it for you' } )
		).not.toBeInTheDocument();
	} );

	// Rendered without a SessionUIProvider, so the open-site-url hook takes
	// its browser fallback path; inside the app these open the preview panel.
	it( 'routes open and settings shortcuts through existing APIs', async () => {
		render( <SiteOverviewView siteId="site-1" /> );

		fireEvent.click( screen.getByText( 'Site Editor' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Media Library' ).closest( 'button' )! );

		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/site-editor.php' )
		);
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/upload.php' );
	} );

	it( 'opens the plugins and themes screens from their sections', async () => {
		render( <SiteOverviewView siteId="site-1" /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Plugins' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Themes' } ) );

		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/plugins.php' )
		);
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/themes.php' );
	} );
} );

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Demo Site',
		path: '/Users/example/Studio/demo-site',
		port: 8881,
		running: false,
		phpVersion: '8.4',
		adminUsername: 'admin',
		adminEmail: 'admin@example.com',
		enableDebugLog: true,
		themeDetails: {
			name: 'Twenty Twenty-Six',
			path: '/wp-content/themes/twentytwentysix',
			slug: 'twentytwentysix',
			isBlockTheme: true,
		},
		...overrides,
	};
}
