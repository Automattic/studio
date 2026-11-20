import * as Sentry from '@sentry/electron/main';
import { updateConfig } from '@studio/common/lib/config/store';
import { describe, expect, it, vi } from 'vitest';
import { phoneAccess } from 'src/modules/phone-access/lib/app-phone-access';

vi.mock( '@sentry/electron/main', () => ( { captureException: vi.fn() } ) );
vi.mock( '@studio/common/lib/config/store', () => ( {
	readConfig: vi.fn( async () => ( { desktop: { phoneAccess: true } } ) ),
	updateConfig: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/remote-access', () => ( {
	readRemoteServerInfo: vi.fn( async () => undefined ),
} ) );
vi.mock( '@studio/common/lib/port-finder', () => ( { isPortFree: vi.fn( async () => true ) } ) );
vi.mock( 'src/modules/phone-access/lib/remote-process', () => ( {
	isProcessAlive: vi.fn( () => false ),
	startRemote: vi.fn(),
} ) );

describe( "the app's remote mode", () => {
	// The switch must not look off while the config keeps it on: remote mode
	// would start again at the next launch.
	it( 'fails to turn off when the switch cannot be saved, and reports why', async () => {
		const failure = new Error( 'Config lock timed out' );
		vi.mocked( updateConfig ).mockRejectedValue( failure );

		await expect( phoneAccess.turnOff() ).rejects.toThrow( 'Config lock timed out' );

		expect( Sentry.captureException ).toHaveBeenCalledWith( failure );
	} );
} );
