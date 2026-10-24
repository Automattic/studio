import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useUpdateSite } from '@/data/queries/use-sites';
import { SettingsDialog } from './index';
import type { SiteDetails } from '@/data/core';

let search: Record< string, unknown > = {};
const navigate = vi.fn( ( { search: update }: { search: ( previous: object ) => object } ) => {
	search = update( search ) as Record< string, unknown >;
} );
const back = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useSearch: () => search,
	useNavigate: () => navigate,
	useRouter: () => ( { history: { canGoBack: () => true, back } } ),
	useParams: () => ( {} ),
} ) );

vi.mock( '@/components/settings-view', async () => {
	const { SettingsRow } = await vi.importActual< typeof import('@/components/settings-view/rows') >(
		'@/components/settings-view/rows'
	);
	const panel = ( name: string ) => () => <p>{ name }</p>;
	return {
		AiPanel: panel( 'AI providers panel' ),
		AppearanceSettings: () => (
			<SettingsRow title="Theme" description={ <button type="button">Learn more</button> }>
				<input aria-label="Theme" />
			</SettingsRow>
		),
		GeneralSettings: panel( 'General panel' ),
		InstructionsSettings: panel( 'Instructions panel' ),
		KeyboardPanel: panel( 'Keyboard panel' ),
		McpPanel: panel( 'MCP panel' ),
		SharingPanel: panel( 'Sharing panel' ),
		SkillsPanel: panel( 'Skills panel' ),
		UsagePanel: panel( 'Usage panel' ),
	};
} );
vi.mock( './site-agent-files', () => ( { SiteAgentFiles: () => null } ) );
vi.mock( '@/components/settings-view/account-section', () => ( { ConnectionCard: () => null } ) );
vi.mock( '@/components/learn-more', () => ( {
	LearnHowLink: () => null,
	LearnMoreLink: () => null,
} ) );
vi.mock( '@/data/app-messages', () => ( { toast: { info: vi.fn() } } ) );
vi.mock( '@/data/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/core') >() ),
	useConnector: () => ( { copyText: vi.fn() } ),
} ) );
vi.mock( '@/data/queries/use-auth-user', () => ( { useAuthUser: vi.fn() } ) );
vi.mock( '@/data/queries/use-sessions', () => ( { useSessions: () => ( { data: [] } ) } ) );
vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useExistingCustomDomains: () => [],
} ) );
vi.mock( '@/data/queries/use-debug-log', () => ( {
	useDebugLogExists: () => ( { data: false } ),
} ) );
vi.mock( '@/data/queries/use-certificate-trust', () => ( {
	useCertificateTrust: () => ( { data: true } ),
	useTrustCertificate: () => ( { mutate: vi.fn(), isPending: false } ),
} ) );
vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: [ SITE ] } ),
	useIsSiteBusy: () => false,
	useUpdateSite: vi.fn(),
	useXdebugEnabledSite: () => undefined,
} ) );
vi.mock( '@/data/queries/use-wordpress-versions', () => ( {
	useWordPressVersions: () => ( { data: [] } ),
	useWpVersion: () => ( { data: '6.9' } ),
} ) );
vi.mock( '@/hooks/use-offline', () => ( { useOffline: () => false } ) );

const SITE = {
	id: 'site-1',
	name: 'My Site',
	phpVersion: '8.3',
	adminUsername: 'admin',
	adminEmail: 'admin@localhost.com',
} as SiteDetails;
const updateSite = vi.fn();

function renderDialog( initial: Record< string, unknown > ) {
	search = initial;
	const view = render( <SettingsDialog /> );
	return {
		// Re-renders after the dialog navigated, as the router would.
		update: () => view.rerender( <SettingsDialog /> ),
	};
}

describe( 'SettingsDialog', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useAuthUser ).mockReturnValue( {
			data: { id: 1 },
			isSuccess: true,
		} as never );
		vi.mocked( useUpdateSite ).mockReturnValue( {
			mutate: updateSite,
			isPending: false,
		} as never );
	} );

	it( 'keeps unsaved site changes reachable from another section, and closes once they are discarded', async () => {
		const dialog = renderDialog( { settings: 'site' } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Site name' } ), {
			target: { value: 'Renamed' },
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Studio' } ) );
		dialog.update();
		expect( search.settings ).toBe( 'general' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );
		expect( back ).not.toHaveBeenCalled();
		const discard = screen.getByRole( 'button', { name: 'Discard' } );
		await waitFor( () => expect( discard ).toHaveFocus() );

		fireEvent.click( discard );
		expect( back ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'closes after saving the changes that held it open', () => {
		renderDialog( { settings: 'site' } );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Site name' } ), {
			target: { value: 'Renamed' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close settings' } ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );
		expect( back ).not.toHaveBeenCalled();
		act( () => {
			updateSite.mock.lastCall?.[ 1 ].onSuccess();
		} );

		expect( back ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'opens the top search result on Enter, ranking exact title matches first', () => {
		const dialog = renderDialog( { settings: 'general' } );
		const input = screen.getByRole( 'textbox', { name: 'Search settings' } );

		fireEvent.change( input, { target: { value: 'theme' } } );
		const [ top ] = within(
			screen.getByRole( 'navigation', { name: 'Settings sections' } )
		).getAllByRole( 'button' );
		expect( top ).toHaveTextContent( 'Theme' );
		fireEvent.keyDown( input, { key: 'Enter' } );
		dialog.update();

		expect( search.settings ).toBe( 'appearance' );
	} );

	it( 'finds settings by their description', () => {
		renderDialog( { settings: 'general' } );

		fireEvent.change( screen.getByRole( 'textbox', { name: 'Search settings' } ), {
			target: { value: 'anonymous' },
		} );

		expect( screen.getByText( 'Improve WordPress Studio for everyone' ) ).toBeInTheDocument();
	} );

	it( 'clears the search on Escape without closing', () => {
		renderDialog( { settings: 'general' } );
		const input = screen.getByRole( 'textbox', { name: 'Search settings' } );
		fireEvent.change( input, { target: { value: 'theme' } } );

		fireEvent.keyDown( input, { key: 'Escape' } );

		expect( input ).toHaveValue( '' );
		expect( back ).not.toHaveBeenCalled();
	} );

	// jsdom reports a non-Apple platform, where the primary modifier is Ctrl.
	it( 'goes back and forward through the sections visited', () => {
		const dialog = renderDialog( { settings: 'general' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Keyboard' } ) );
		dialog.update();

		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: '[', ctrlKey: true } );
		dialog.update();
		expect( search.settings ).toBe( 'general' );

		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: ']', ctrlKey: true } );
		dialog.update();
		expect( search.settings ).toBe( 'keyboard' );
	} );

	it( 'focuses the setting a link points at', async () => {
		renderDialog( { settings: 'appearance', settingsFocus: 'theme' } );

		await waitFor( () => expect( screen.getByRole( 'textbox', { name: 'Theme' } ) ).toHaveFocus() );
	} );

	it( 'says so when a linked setting is not on this device', async () => {
		vi.useFakeTimers();
		try {
			renderDialog( { settings: 'general', settingsFocus: 'future-setting' } );
			act( () => {
				vi.advanceTimersByTime( 3000 );
			} );

			expect( toast.info ).toHaveBeenCalledWith( 'This setting is not available on this device.' );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'hides Usage while signed out and opens AI Providers in its place', () => {
		vi.mocked( useAuthUser ).mockReturnValue( { data: null, isSuccess: true } as never );
		renderDialog( { settings: 'usage' } );

		expect( screen.queryByRole( 'button', { name: 'Usage' } ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'AI providers panel' ) ).toBeInTheDocument();
	} );
} );
