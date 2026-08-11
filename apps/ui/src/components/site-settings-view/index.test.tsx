import {
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
} from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useCertificateTrust, useTrustCertificate } from '@/data/queries/use-certificate-trust';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useSites, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { useOffline } from '@/hooks/use-offline';
import { isSiteSettingsTab, SiteSettingsForm, siteSettingsTabToPanel } from './index';
import type { SiteDetails } from '@/data/core';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-certificate-trust', () => ( {
	useCertificateTrust: vi.fn(),
	useTrustCertificate: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
	useUpdateSite: vi.fn(),
	useXdebugEnabledSite: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
	useWpVersion: vi.fn(),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: () => false,
} ) );

vi.mock( '@/components/learn-more', () => ( {
	LearnHowLink: () => null,
	LearnMoreLink: () => null,
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useCertificateTrustMock = vi.mocked( useCertificateTrust, { partial: true } );
const useTrustCertificateMock = vi.mocked( useTrustCertificate, { partial: true } );
const useExistingCustomDomainsMock = vi.mocked( useExistingCustomDomains, { partial: true } );
const useSitesMock = vi.mocked( useSites, { partial: true } );
const useUpdateSiteMock = vi.mocked( useUpdateSite, { partial: true } );
const useXdebugEnabledSiteMock = vi.mocked( useXdebugEnabledSite, { partial: true } );
const useWordPressVersionsMock = vi.mocked( useWordPressVersions, { partial: true } );
const useWpVersionMock = vi.mocked( useWpVersion, { partial: true } );
const useOfflineMock = vi.mocked( useOffline );

const WP_VERSIONS = [
	{ label: '6.8', value: 'latest', isBeta: false, isDevelopment: false },
	{ label: '6.8', value: '6.8', isBeta: false, isDevelopment: false },
	{ label: '6.7.2', value: '6.7.2', isBeta: false, isDevelopment: false },
];

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'My Site',
		path: '/tmp/my-site',
		port: 8881,
		running: true,
		phpVersion: '8.4',
		runtime: SITE_RUNTIME_NATIVE_PHP,
		fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
		...overrides,
	};
}

describe( 'isSiteSettingsTab', () => {
	it( 'recognizes the settings, agent, and checkpoints tabs', () => {
		expect( isSiteSettingsTab( 'settings' ) ).toBe( true );
		expect( isSiteSettingsTab( 'agent' ) ).toBe( true );
		expect( isSiteSettingsTab( 'checkpoints' ) ).toBe( true );
	} );

	it( 'rejects the former general/debugging/skills/instructions tabs', () => {
		expect( isSiteSettingsTab( 'general' ) ).toBe( false );
		expect( isSiteSettingsTab( 'debugging' ) ).toBe( false );
		expect( isSiteSettingsTab( 'skills' ) ).toBe( false );
		expect( isSiteSettingsTab( 'instructions' ) ).toBe( false );
	} );
} );

describe( 'siteSettingsTabToPanel', () => {
	it( 'uses the redesigned tab ids as panel values', () => {
		expect( siteSettingsTabToPanel( 'settings' ) ).toBe( 'settings' );
		expect( siteSettingsTabToPanel( 'agent' ) ).toBe( 'agent' );
		expect( siteSettingsTabToPanel( 'checkpoints' ) ).toBe( 'checkpoints' );
	} );
} );

describe( 'SiteSettingsForm', () => {
	const mutate = vi.fn();

	function renderForm( site = createSite() ) {
		return render(
			<Tooltip.Provider>
				<SiteSettingsForm
					site={ site }
					activeTab="settings"
					onTabChange={ vi.fn() }
					embedded
					showTabs={ false }
				/>
			</Tooltip.Provider>
		);
	}

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( {
			capabilities: {
				nativeFolderPicker: true,
				nativeSaveDialog: true,
				openInOS: true,
				annotatePreview: true,
				readLocalMedia: true,
				siteCheckpoints: false,
				agentInstructions: true,
				studioLogs: true,
				switchToClassicUi: true,
			},
			openSiteDebugLog: vi.fn(),
		} );
		useCertificateTrustMock.mockReturnValue( { data: true } );
		useTrustCertificateMock.mockReturnValue( { mutate: vi.fn() } );
		useExistingCustomDomainsMock.mockReturnValue( [] );
		useSitesMock.mockReturnValue( { data: [ createSite() ], isLoading: false } );
		useUpdateSiteMock.mockReturnValue( { isPending: false, mutate } );
		useXdebugEnabledSiteMock.mockReturnValue( null );
		useWordPressVersionsMock.mockReturnValue( { data: [] } );
		useWpVersionMock.mockReturnValue( { data: undefined } );
		useOfflineMock.mockReturnValue( false );
	} );

	it( 'submits runtime and file access with site updates', async () => {
		const site = createSite( {
			runtime: SITE_RUNTIME_NATIVE_PHP,
			fileAccess: SITE_FILE_ACCESS_ALL_FILES,
		} );

		renderForm( site );

		const nameInput = screen.getByLabelText( /Site name/ );
		fireEvent.change( nameInput, { target: { value: 'Renamed Site' } } );

		const saveButton = screen.getByRole( 'button', { name: 'Save settings' } );
		expect( saveButton ).toBeEnabled();
		fireEvent.click( saveButton );

		await waitFor( () => {
			expect( mutate ).toHaveBeenCalled();
		} );

		const payload = mutate.mock.calls[ 0 ][ 0 ];
		expect( payload.site.name ).toBe( 'Renamed Site' );
		expect( payload.site.runtime ).toBe( SITE_RUNTIME_NATIVE_PHP );
		expect( payload.site.fileAccess ).toBe( SITE_FILE_ACCESS_ALL_FILES );
	} );

	it( 'renders installable WordPress versions with auto-updating selected', () => {
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );

		renderForm();

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select.tagName ).toBe( 'SELECT' );
		expect( select ).toHaveValue( '' );
		expect( screen.getByRole( 'option', { name: '6.7.2' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'group', { name: 'Auto-updating' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'group', { name: 'Stable Versions' } ) ).toBeInTheDocument();
	} );

	it( 'saves a pinned WordPress version picked from the dropdown', () => {
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );

		renderForm();

		fireEvent.change( screen.getByLabelText( 'WordPress version' ), {
			target: { value: '6.7.2' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { isWpAutoUpdating: false } ),
				wpVersion: '6.7.2',
			} ),
			expect.anything()
		);
	} );

	it( 'shows an installed pinned version that is missing from the fetched list', () => {
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );

		renderForm( createSite( { isWpAutoUpdating: false } ) );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select ).toHaveValue( '6.5.2' );
		expect( screen.getByRole( 'option', { name: '6.5.2' } ) ).toBeInTheDocument();
	} );

	it( 'does not reinstall WordPress when saving an unrelated pinned-site change', () => {
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );

		renderForm( createSite( { isWpAutoUpdating: false } ) );

		fireEvent.change( screen.getByDisplayValue( 'My Site' ), {
			target: { value: 'Renamed Site' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { name: 'Renamed Site', isWpAutoUpdating: false } ),
				wpVersion: undefined,
			} ),
			expect.anything()
		);
	} );

	it( 'keeps the picked version while a save restarts the site', () => {
		useUpdateSiteMock.mockReturnValue( { isPending: true, mutate } );
		useWpVersionMock.mockReturnValue( { data: '6.8' } );
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		const site = createSite( { isWpAutoUpdating: false } );

		const { rerender } = renderForm( site );

		fireEvent.change( screen.getByLabelText( 'WordPress version' ), {
			target: { value: '6.7.2' },
		} );
		rerender(
			<Tooltip.Provider>
				<SiteSettingsForm
					site={ { ...site, running: false } }
					activeTab="settings"
					onTabChange={ vi.fn() }
					embedded
					showTabs={ false }
				/>
			</Tooltip.Provider>
		);

		expect( screen.getByLabelText( 'WordPress version' ) ).toHaveValue( '6.7.2' );
	} );

	it( 'keeps pinned sites pinned when saving other settings offline', () => {
		useOfflineMock.mockReturnValue( true );
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );

		renderForm( createSite( { isWpAutoUpdating: false } ) );

		fireEvent.change( screen.getByDisplayValue( 'My Site' ), {
			target: { value: 'Renamed Site' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { name: 'Renamed Site', isWpAutoUpdating: false } ),
				wpVersion: undefined,
			} ),
			expect.anything()
		);
	} );

	it( 'keeps the WordPress version field a dropdown when offers are unavailable', () => {
		renderForm();

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select.tagName ).toBe( 'SELECT' );
		expect( select ).toHaveValue( '' );
	} );

	it( 'disables WordPress version changes offline without changing the displayed value', async () => {
		useOfflineMock.mockReturnValue( true );
		useWpVersionMock.mockReturnValue( { data: '6.5.2' } );

		renderForm( createSite( { isWpAutoUpdating: false } ) );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select ).toBeDisabled();
		expect( select ).toHaveValue( '6.5.2' );

		const trigger = select.closest( 'div[style*="pointer-events"]' )?.parentElement as HTMLElement;
		fireEvent.mouseEnter( trigger );
		fireEvent.mouseMove( trigger, { movementX: 1, movementY: 1 } );
		expect(
			await screen.findByText(
				'Changing WordPress version requires an internet connection.',
				{},
				{ timeout: 2000 }
			)
		).toBeVisible();
	} );

	it( 'installs latest when a pinned site switches back to auto-updating', () => {
		useWordPressVersionsMock.mockReturnValue( { data: WP_VERSIONS } );
		const site = createSite( { isWpAutoUpdating: false } );

		renderForm( site );

		const select = screen.getByLabelText( 'WordPress version' );
		expect( select ).toHaveValue( 'latest' );
		fireEvent.change( select, { target: { value: '' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save settings' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			expect.objectContaining( {
				site: expect.objectContaining( { isWpAutoUpdating: true } ),
				wpVersion: 'latest',
			} ),
			expect.anything()
		);
	} );
} );
