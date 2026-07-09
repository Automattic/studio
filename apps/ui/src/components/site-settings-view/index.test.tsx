import {
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
} from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useCertificateTrust, useTrustCertificate } from '@/data/queries/use-certificate-trust';
import { useExistingCustomDomains } from '@/data/queries/use-create-site-helpers';
import { useSites, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useWordPressVersions } from '@/data/queries/use-wordpress-versions';
import { isSiteSettingsTab, SiteSettingsForm } from './index';
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

describe( 'SiteSettingsForm', () => {
	const mutate = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( {
			capabilities: {
				nativeFolderPicker: true,
				nativeSaveDialog: true,
				openInOS: true,
				annotatePreview: true,
				siteCheckpoints: false,
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
	} );

	it( 'submits runtime and file access with site updates', async () => {
		const site = createSite( {
			runtime: SITE_RUNTIME_NATIVE_PHP,
			fileAccess: SITE_FILE_ACCESS_ALL_FILES,
		} );

		render(
			<SiteSettingsForm
				site={ site }
				activeTab="settings"
				onTabChange={ vi.fn() }
				embedded
				showTabs={ false }
			/>
		);

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
} );
