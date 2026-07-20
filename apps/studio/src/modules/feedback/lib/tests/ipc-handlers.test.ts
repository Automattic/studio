/**
 * @vitest-environment node
 *
 * To run: npm run test -- src/modules/feedback/lib/tests/ipc-handlers.test.ts
 */
import { vi } from 'vitest';
import { getAuthenticationToken } from 'src/lib/oauth';
import { FEEDBACK_API_URL, LOG_TAIL_BYTES } from 'src/modules/feedback/lib/feedback-schema';
import { submitFeedback } from 'src/modules/feedback/lib/ipc-handlers';
import { loadUserData, saveUserData } from 'src/storage/user-data';

const mockWpcomPost = vi.fn();
const mockReadFile = vi.fn();

vi.mock( 'electron', () => ( {
	app: { getVersion: () => '9.9.9' },
	shell: { openPath: vi.fn( async () => '' ) },
} ) );
vi.mock( 'fs/promises', () => ( {
	default: { readFile: ( ...args: unknown[] ) => mockReadFile( ...args ) },
} ) );
vi.mock( 'src/lib/oauth', () => ( { getAuthenticationToken: vi.fn() } ) );
vi.mock( 'src/logging', () => ( { getLogsFilePath: vi.fn( () => '/mock/studio.log' ) } ) );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	default: () => ( { req: { post: mockWpcomPost } } ),
} ) );
vi.mock( '@studio/common/lib/wpcom-xhr-request-factory', () => ( { default: vi.fn() } ) );
vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn( async () => ( { sentryUserId: 'anon-uuid' } ) ),
	lockAppdata: vi.fn(),
	unlockAppdata: vi.fn(),
	saveUserData: vi.fn(),
} ) );
vi.mock( 'src/lib/bump-stats', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	bumpStat: vi.fn(),
} ) );

const AUTH_TOKEN = {
	accessToken: 'tok',
	id: 42,
	email: 'user@example.com',
	displayName: 'Test User',
	expiresIn: 3600,
	expirationTime: Date.now() + 10_000,
};

const VALID_INPUT = {
	message: 'The app is great',
	includeLogs: false,
	category: 'general' as const,
};

const event = {} as Electron.IpcMainInvokeEvent;
const originalFetch = global.fetch;

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( getAuthenticationToken ).mockResolvedValue( null );
	vi.mocked( loadUserData ).mockResolvedValue( { sentryUserId: 'anon-uuid' } as never );
	mockReadFile.mockResolvedValue( 'log line one\nlog line two\n' );
	global.fetch = vi.fn( async () => ( { ok: true, status: 200 } ) as Response );
} );

afterEach( () => {
	global.fetch = originalFetch;
} );

describe( 'submitFeedback', () => {
	it( 'rejects invalid input without making a network request', async () => {
		const result = await submitFeedback( event, { message: '   ' } );

		expect( result ).toEqual( { success: false, error: 'validation' } );
		expect( global.fetch ).not.toHaveBeenCalled();
		expect( mockWpcomPost ).not.toHaveBeenCalled();
	} );

	it( 'posts anonymously with the installation id and optional contact email', async () => {
		const result = await submitFeedback( event, {
			...VALID_INPUT,
			email: 'reply@example.com',
		} );

		expect( result ).toEqual( { success: true } );
		expect( mockWpcomPost ).not.toHaveBeenCalled();
		const [ url, options ] = vi.mocked( global.fetch ).mock.calls[ 0 ];
		expect( url ).toBe( FEEDBACK_API_URL );
		const body = JSON.parse( ( options as RequestInit ).body as string );
		expect( body.identity ).toEqual( {
			type: 'anonymous',
			anonymousId: 'anon-uuid',
			contactEmail: 'reply@example.com',
		} );
		expect( body.appVersion ).toBe( '9.9.9' );
	} );

	it( 'posts as the wpcom user through the authenticated client when logged in', async () => {
		vi.mocked( getAuthenticationToken ).mockResolvedValue( AUTH_TOKEN );

		const result = await submitFeedback( event, VALID_INPUT );

		expect( result ).toEqual( { success: true } );
		expect( global.fetch ).not.toHaveBeenCalled();
		expect( mockWpcomPost ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/studio-app/feedback',
				apiNamespace: 'wpcom/v2',
				body: expect.objectContaining( {
					identity: {
						type: 'wpcom',
						wpcomUserId: 42,
						email: 'user@example.com',
						displayName: 'Test User',
					},
				} ),
			} )
		);
	} );

	it( 'attaches a sanitized, truncated log tail when includeLogs is set', async () => {
		const filler = 'x'.repeat( LOG_TAIL_BYTES );
		mockReadFile.mockResolvedValue( `password=hunter2\n${ filler }` );

		await submitFeedback( event, { ...VALID_INPUT, includeLogs: true } );

		const body = JSON.parse(
			( vi.mocked( global.fetch ).mock.calls[ 0 ][ 1 ] as RequestInit ).body as string
		);
		expect( body.logs.length ).toBeLessThanOrEqual( LOG_TAIL_BYTES );
		// The oldest line (with the secret) is dropped by tail truncation.
		expect( body.logs ).not.toContain( 'hunter2' );
	} );

	it( 'redacts sensitive lines in the attached logs', async () => {
		mockReadFile.mockResolvedValue( 'token=abc123\nnormal line\n' );

		await submitFeedback( event, { ...VALID_INPUT, includeLogs: true } );

		const body = JSON.parse(
			( vi.mocked( global.fetch ).mock.calls[ 0 ][ 1 ] as RequestInit ).body as string
		);
		expect( body.logs ).toContain( 'REDACTED' );
		expect( body.logs ).not.toContain( 'abc123' );
	} );

	it( 'omits logs but still succeeds when the log file cannot be read', async () => {
		mockReadFile.mockRejectedValue( new Error( 'ENOENT' ) );

		const result = await submitFeedback( event, { ...VALID_INPUT, includeLogs: true } );

		expect( result ).toEqual( { success: true } );
		const body = JSON.parse(
			( vi.mocked( global.fetch ).mock.calls[ 0 ][ 1 ] as RequestInit ).body as string
		);
		expect( body.logs ).toBeUndefined();
	} );

	it( 'does not read logs when includeLogs is false', async () => {
		await submitFeedback( event, VALID_INPUT );

		expect( mockReadFile ).not.toHaveBeenCalled();
	} );

	it( 'returns a server error on a non-ok anonymous response', async () => {
		global.fetch = vi.fn( async () => ( { ok: false, status: 500 } ) as Response );

		const result = await submitFeedback( event, VALID_INPUT );

		expect( result ).toEqual( { success: false, error: 'server' } );
	} );

	it( 'returns a network error when the request throws', async () => {
		global.fetch = vi.fn( async () => {
			throw new Error( 'offline' );
		} );

		const result = await submitFeedback( event, VALID_INPUT );

		expect( result ).toEqual( { success: false, error: 'network' } );
	} );

	it( 'lazily generates and persists an anonymous id when none exists', async () => {
		vi.mocked( loadUserData ).mockResolvedValue( {} as never );

		const result = await submitFeedback( event, VALID_INPUT );

		expect( result ).toEqual( { success: true } );
		expect( saveUserData ).toHaveBeenCalledWith(
			expect.objectContaining( { sentryUserId: expect.any( String ) } )
		);
	} );
} );
