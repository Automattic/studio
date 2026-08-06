/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';

const installCliWithConfirmation = vi.fn();
const uninstallCliWithConfirmation = vi.fn();

vi.mock( 'src/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('src/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( 'src/modules/cli/lib/macos-installation-manager', () => ( {
	createMacOSCliInstallationManager: () => ( {
		isCliInstalled: vi.fn(),
		isCliExternallyManaged: vi.fn(),
		installCliWithConfirmation,
		uninstallCliWithConfirmation,
	} ),
} ) );
vi.mock( 'src/modules/cli/lib/linux-installation-manager', () => ( {
	createLinuxCliInstallationManager: vi.fn(),
} ) );
vi.mock( 'src/modules/cli/lib/windows-installation-manager', () => ( {
	WindowsCliInstallationManager: vi.fn(),
} ) );
vi.mock( 'src/main-window', () => ( { getMainWindow: vi.fn() } ) );

const mockRecord = vi.mocked( recordTracksEvent );

let installStudioCli: typeof import('src/modules/cli/lib/ipc-handlers').installStudioCli;
let uninstallStudioCli: typeof import('src/modules/cli/lib/ipc-handlers').uninstallStudioCli;

beforeEach( async () => {
	vi.clearAllMocks();
	// The confirmation dialog is only shown outside production; skip it so the tests exercise
	// the committed-install path directly.
	vi.stubEnv( 'NODE_ENV', 'production' );
	vi.stubGlobal( 'process', { ...process, platform: 'darwin' } );
	( { installStudioCli, uninstallStudioCli } = await import( 'src/modules/cli/lib/ipc-handlers' ) );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
} );

it( 'emits studio_setting_cli_change with installed true after a confirmed install', async () => {
	await installStudioCli();

	expect( installCliWithConfirmation ).toHaveBeenCalled();
	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_CLI_CHANGE, {
		installed: true,
		surface: 'settings',
	} );
} );

it( 'emits studio_setting_cli_change with installed false after a confirmed uninstall', async () => {
	await uninstallStudioCli();

	expect( uninstallCliWithConfirmation ).toHaveBeenCalled();
	expect( mockRecord ).toHaveBeenCalledWith( TRACKS_EVENTS.SETTING_CLI_CHANGE, {
		installed: false,
		surface: 'settings',
	} );
} );
