import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialogContext } from '@/components/settings-dialog/context';
import { useIsSiteBusy, useUpdateSite, useXdebugEnabledSite } from '@/data/queries/use-sites';
import { useWordPressVersions, useWpVersion } from '@/data/queries/use-wordpress-versions';
import { SiteSettingsForm } from './index';
import type { SiteSettingsSectionId } from '@/components/settings-dialog/context';
import type { SiteDetails } from '@/data/core';

// Base UI's switch dispatches a PointerEvent, which jsdom lacks.
vi.stubGlobal( 'PointerEvent', window.PointerEvent ?? MouseEvent );

vi.mock( '@/components/learn-more', () => ( {
	LearnHowLink: () => null,
	LearnMoreLink: () => null,
} ) );
vi.mock( '@/components/settings-view/account-section', () => ( { ConnectionCard: () => null } ) );
vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/core') >() ),
	useConnector: () => ( { openSiteDebugLog: vi.fn() } ),
} ) );
vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: () => [ 'taken.wp.local' ],
} ) );
vi.mock( '@/data/queries/use-debug-log', () => ( {
	useDebugLogExists: () => ( { data: false } ),
} ) );
vi.mock( '@/data/queries/use-certificate-trust', () => ( {
	useCertificateTrust: () => ( { data: true } ),
	useTrustCertificate: () => ( { mutate: vi.fn(), isPending: false } ),
} ) );
vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteBusy: vi.fn(),
	useUpdateSite: vi.fn(),
	useXdebugEnabledSite: vi.fn(),
} ) );
vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: vi.fn(),
	useWpVersion: vi.fn(),
} ) );
vi.mock( '@/hooks/use-offline', () => ( { useOffline: () => false } ) );

const SITE = {
	id: 'site-1',
	name: 'My Site',
	phpVersion: '8.3',
	isWpAutoUpdating: true,
	adminUsername: 'admin',
	adminEmail: 'admin@localhost.com',
} as SiteDetails;
const mutate = vi.fn();
const settle = vi.fn();

function renderForm( section: SiteSettingsSectionId = 'site', site = SITE ) {
	const actions = document.createElement( 'div' );
	document.body.append( actions );
	render(
		<SettingsDialogContext.Provider value={ { actions, setDirty: vi.fn(), settle } }>
			<SiteSettingsForm site={ site } section={ section } />
		</SettingsDialogContext.Provider>
	);
}

describe( 'SiteSettingsForm', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useUpdateSite ).mockReturnValue( {
			mutate,
			isPending: false,
		} as unknown as ReturnType< typeof useUpdateSite > );
		vi.mocked( useWordPressVersions ).mockReturnValue( {
			data: [
				{ label: '6.9', value: 'latest', isBeta: false, isDevelopment: false },
				{ label: '6.9', value: '6.9', isBeta: false, isDevelopment: false },
			],
		} as ReturnType< typeof useWordPressVersions > );
		vi.mocked( useWpVersion ).mockReturnValue( { data: '6.9' } as ReturnType<
			typeof useWpVersion
		> );
		vi.mocked( useIsSiteBusy ).mockReturnValue( false );
		vi.mocked( useXdebugEnabledSite ).mockReturnValue( null );
	} );

	it( 'runs the attempted exit once changes are discarded', () => {
		renderForm();
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Site name' } ), {
			target: { value: 'Renamed' },
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Discard' } ) );

		expect( settle ).toHaveBeenCalled();
		expect( screen.getByRole( 'textbox', { name: 'Site name' } ) ).toHaveValue( 'My Site' );
	} );

	it( 'runs the attempted exit once changes are saved', () => {
		renderForm();
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Site name' } ), {
			target: { value: 'Renamed' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining( { onSuccess: settle } )
		);
	} );

	it( 'locks the form while another site operation runs', () => {
		vi.mocked( useIsSiteBusy ).mockReturnValue( true );
		renderForm();

		expect(
			screen.getByText( 'Wait for the current site operation to finish before changing settings.' )
		).toBeInTheDocument();
		expect( screen.getByRole( 'textbox', { name: 'Site name' } ) ).toBeDisabled();
	} );

	it( 'disables Xdebug while another site has it, and says which', () => {
		vi.mocked( useXdebugEnabledSite ).mockReturnValue( {
			id: 'site-2',
			name: 'Other Site',
		} as SiteDetails );
		renderForm( 'debugging' );

		expect( screen.getByRole( 'switch', { name: 'Xdebug' } ) ).toHaveAttribute( 'data-disabled' );
		expect(
			screen.getByText( 'Xdebug is enabled on another site: Other Site' )
		).toBeInTheDocument();
	} );

	it( 'keeps an unsupported PHP version listed with the version that runs instead', () => {
		renderForm( 'php', { ...SITE, phpVersion: '7.4' } );

		expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent( '7.4' );
		expect( screen.getByText( 'Native PHP will use 8.2' ) ).toBeInTheDocument();
	} );

	it( 'saves a renamed site', () => {
		renderForm();
		expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
			'Auto-update (6.9)'
		);

		fireEvent.change( screen.getByRole( 'textbox', { name: 'Site name' } ), {
			target: { value: 'Renamed' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mutate ).toHaveBeenCalledWith(
			{ site: expect.objectContaining( { name: 'Renamed' } ), wpVersion: undefined },
			expect.anything()
		);
	} );

	it( 'blocks saving invalid values and explains why', async () => {
		renderForm();
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Site name' } ), {
			target: { value: '' },
		} );
		expect( screen.getByText( 'Site name is required.' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();

		fireEvent.change( screen.getByRole( 'textbox', { name: 'Site name' } ), {
			target: { value: 'Taken' },
		} );
		await userEvent.click( screen.getByRole( 'switch', { name: 'Use custom domain' } ) );
		expect( screen.getByRole( 'textbox', { name: 'Domain' } ) ).toHaveValue( 'taken.wp.local' );
		expect( screen.getByRole( 'textbox', { name: 'Domain' } ) ).toBeInvalid();
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'pins the installed version when automatic updates are turned off', async () => {
		renderForm();
		await userEvent.click( screen.getByRole( 'switch', { name: 'Automatic updates' } ) );
		expect( screen.getByRole( 'combobox', { name: 'WordPress version' } ) ).toHaveTextContent(
			'6.9'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		expect( mutate ).toHaveBeenCalledWith(
			{ site: expect.objectContaining( { isWpAutoUpdating: false } ), wpVersion: '6.9' },
			expect.anything()
		);
	} );

	it( 'changes the PHP version', async () => {
		renderForm( 'php' );
		await userEvent.click( screen.getByRole( 'combobox', { name: 'PHP version' } ) );
		await userEvent.click( await screen.findByRole( 'option', { name: '8.2' } ) );

		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'PHP version' } ) ).toHaveTextContent( '8.2' )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		expect( mutate ).toHaveBeenCalledWith(
			expect.objectContaining( { site: expect.objectContaining( { phpVersion: '8.2' } ) } ),
			expect.anything()
		);
	} );
} );
