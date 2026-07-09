// To run tests, execute `npm run test -- src/modules/user-settings/components/tests/preferences-tab.actions.test.tsx` from the root directory
/**
 * Localization settings UI tests (STU-1872).
 *
 * Companion to the CLI e2e suite (localization.e2e.test.ts): that proves a
 * created site inherits the Studio locale; this proves the UI half — the
 * language picker lists the supported languages and saving one fires the
 * `saveUserLocale` command. Following the #3950 pattern it mounts the real
 * component and store and mocks only the IPC bridge.
 */
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { beforeEach, vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { PreferencesTab } from 'src/modules/user-settings/components/preferences-tab';
import { store } from 'src/stores';
import { saveUserLocale } from 'src/stores/i18n-slice';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: () => ( { platform: 'darwin' } ),
	isMac: () => true,
	isWindows: () => false,
	isLinux: () => false,
	isWindowsStore: () => false,
} ) );

function renderPreferences() {
	return render(
		<Provider store={ store }>
			<PreferencesTab onClose={ vi.fn() } />
		</Provider>
	);
}

beforeEach( async () => {
	vi.clearAllMocks();
	vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
		// RTK Query mount-time reads.
		getColorScheme: vi.fn().mockResolvedValue( 'light' ),
		getUserEditor: vi.fn().mockResolvedValue( null ),
		getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
		getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( { terminals: [], editors: [] } ),
		isStudioCliInstalled: vi.fn().mockResolvedValue( false ),
		getDefaultSiteDirectory: vi.fn().mockResolvedValue( '/mock/sites' ),
		// Save path.
		saveUserLocale: vi.fn().mockResolvedValue( undefined ),
		setDefaultLocaleData: vi.fn().mockResolvedValue( undefined ),
		resetDefaultLocaleData: vi.fn().mockResolvedValue( undefined ),
		setupAppMenu: vi.fn().mockResolvedValue( undefined ),
	} );

	// Saving mutates the shared singleton store's locale; restore it so tests
	// don't depend on run order.
	await store.dispatch( saveUserLocale( DEFAULT_LOCALE ) );
} );

describe( 'PreferencesTab — language (IPC command boundary)', () => {
	it( 'lists the supported languages', () => {
		renderPreferences();

		const select = screen.getByTestId( 'language-select' );
		// A representative spread, including an RTL locale.
		for ( const name of [ 'English', 'Français', '日本語', 'العربية' ] ) {
			expect( screen.getByRole( 'option', { name } ) ).toBeInTheDocument();
		}
		expect( select ).toHaveValue( 'en' );
	} );

	it( 'saving a new language fires saveUserLocale with the selected locale', async () => {
		const user = userEvent.setup();
		renderPreferences();

		await user.selectOptions( screen.getByTestId( 'language-select' ), 'fr' );

		const save = screen.getByTestId( 'preferences-save-button' );
		await waitFor( () => expect( save ).toBeEnabled() );
		await user.click( save );

		await waitFor( () => {
			expect( getIpcApi().saveUserLocale ).toHaveBeenCalledWith( 'fr' );
		} );
	} );
} );
