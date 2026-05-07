/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { BackgroundTaskScheduler } from 'src/lib/background-tasks';

vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
} ) );

describe( 'BackgroundTaskScheduler', () => {
	it( 'runs a task and emits lifecycle telemetry', async () => {
		let now = 100;
		const events: string[] = [];
		const scheduler = new BackgroundTaskScheduler( {
			now: () => now,
			onEvent: ( event ) => events.push( event.status ),
		} );

		await scheduler.enqueue( {
			name: 'task',
			scope: 'site:1',
			run: async () => {
				now = 175;
			},
		} );

		expect( events ).toEqual( [ 'enqueued', 'started', 'succeeded' ] );
		expect( scheduler.getPendingCount() ).toBe( 0 );
	} );

	it( 'deduplicates queued work by key', async () => {
		vi.useFakeTimers();
		try {
			const events: string[] = [];
			const run = vi.fn().mockResolvedValue( undefined );
			const scheduler = new BackgroundTaskScheduler( {
				onEvent: ( event ) => events.push( event.status ),
			} );

			const first = scheduler.enqueue( {
				name: 'task',
				scope: 'site:1',
				delayMs: 100,
				run,
			} );
			const second = scheduler.enqueue( {
				name: 'task',
				scope: 'site:1',
				delayMs: 100,
				run,
			} );

			expect( second ).toBe( first );
			expect( events ).toEqual( [ 'enqueued', 'deduped' ] );

			await vi.advanceTimersByTimeAsync( 100 );
			await first;

			expect( run ).toHaveBeenCalledTimes( 1 );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'skips tasks when the running guard fails', async () => {
		const run = vi.fn().mockResolvedValue( undefined );
		const events: string[] = [];
		const scheduler = new BackgroundTaskScheduler( {
			onEvent: ( event ) => events.push( event.status ),
		} );

		await scheduler.enqueue( {
			name: 'task',
			scope: 'site:1',
			requiresRunning: () => false,
			run,
		} );

		expect( run ).not.toHaveBeenCalled();
		expect( events ).toEqual( [ 'enqueued', 'skipped' ] );
	} );

	it( 'cancels delayed tasks before they start', async () => {
		vi.useFakeTimers();
		try {
			const run = vi.fn().mockResolvedValue( undefined );
			const scheduler = new BackgroundTaskScheduler();

			const task = scheduler.enqueue( {
				name: 'task',
				scope: 'site:1',
				delayMs: 100,
				run,
			} );

			expect( scheduler.cancel( { name: 'task', scope: 'site:1' } ) ).toBe( true );
			await vi.advanceTimersByTimeAsync( 100 );
			await task;

			expect( run ).not.toHaveBeenCalled();
			expect( scheduler.getPendingCount() ).toBe( 0 );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'serializes tasks in the same concurrency group', async () => {
		let finishFirst!: () => void;
		const order: string[] = [];
		const scheduler = new BackgroundTaskScheduler();

		const first = scheduler.enqueue( {
			name: 'first',
			concurrencyGroup: 'group',
			run: async () => {
				order.push( 'first:start' );
				await new Promise< void >( ( resolve ) => {
					finishFirst = resolve;
				} );
				order.push( 'first:end' );
			},
		} );
		const second = scheduler.enqueue( {
			name: 'second',
			concurrencyGroup: 'group',
			run: async () => {
				order.push( 'second:start' );
			},
		} );

		await Promise.resolve();
		expect( order ).toEqual( [ 'first:start' ] );

		finishFirst();
		await Promise.all( [ first, second ] );

		expect( order ).toEqual( [ 'first:start', 'first:end', 'second:start' ] );
	} );

	it( 'surfaces task failures to callers', async () => {
		const scheduler = new BackgroundTaskScheduler();
		const error = new Error( 'boom' );

		await expect(
			scheduler.enqueue( {
				name: 'task',
				run: async () => {
					throw error;
				},
			} )
		).rejects.toThrow( 'boom' );
	} );
} );
