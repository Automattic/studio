/**
 * @vitest-environment node
 */
import { vi } from 'vitest';

const enqueueMock = vi.fn();

vi.mock( 'src/lib/background-tasks', () => ( {
	backgroundTasks: {
		enqueue: enqueueMock,
	},
} ) );

describe( 'scheduleLocalAdminChecksRefresh', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		enqueueMock.mockResolvedValue( undefined );
	} );

	it( 'queues a per-site WP-CLI admin checks refresh task', async () => {
		const executeWpCliCommand = vi.fn().mockResolvedValue( {
			stdout: 'Success: Executed a total of 1 cron event.',
			stderr: '',
			exitCode: 0,
		} );
		const server = {
			details: { id: 'site-1', running: true },
			executeWpCliCommand,
		};

		const { scheduleLocalAdminChecksRefresh } = await import( 'src/lib/site-maintenance-tasks' );
		await scheduleLocalAdminChecksRefresh( server as never, 'test' );

		expect( enqueueMock ).toHaveBeenCalledWith( {
			name: 'refresh-local-admin-checks',
			scope: 'site:site-1',
			trigger: 'test',
			delayMs: 1000,
			requiresRunning: expect.any( Function ),
			run: expect.any( Function ),
		} );

		const task = enqueueMock.mock.calls[ 0 ][ 0 ];
		expect( task.requiresRunning() ).toBe( true );
		await task.run( { signal: new AbortController().signal } );

		expect( executeWpCliCommand ).toHaveBeenCalledWith( [
			'eval',
			expect.stringContaining( 'wp_version_check();' ),
		] );
		expect( executeWpCliCommand.mock.calls[ 0 ][ 0 ][ 1 ] ).toContain( 'wp_update_plugins();' );
		expect( executeWpCliCommand.mock.calls[ 0 ][ 0 ][ 1 ] ).toContain( 'wp_update_themes();' );
		expect( executeWpCliCommand.mock.calls[ 0 ][ 0 ][ 1 ] ).toContain(
			'wp_check_browser_version();'
		);
		expect( executeWpCliCommand.mock.calls[ 0 ][ 0 ][ 1 ] ).toContain( 'wp_check_php_version();' );
		expect( executeWpCliCommand.mock.calls[ 0 ][ 0 ][ 1 ] ).toContain(
			'wp_get_available_translations();'
		);
	} );

	it( 'fails when WP-CLI cannot refresh local admin checks', async () => {
		const executeWpCliCommand = vi.fn().mockResolvedValue( {
			stdout: '',
			stderr: 'Error: No events ran.',
			exitCode: 1,
		} );
		const server = {
			details: { id: 'site-1', running: true },
			executeWpCliCommand,
		};

		const { scheduleLocalAdminChecksRefresh } = await import( 'src/lib/site-maintenance-tasks' );
		await scheduleLocalAdminChecksRefresh( server as never );

		const task = enqueueMock.mock.calls[ 0 ][ 0 ];
		await expect( task.run( { signal: new AbortController().signal } ) ).rejects.toThrow(
			'Error: No events ran.'
		);
	} );
} );
