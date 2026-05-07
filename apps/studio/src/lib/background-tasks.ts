import * as Sentry from '@sentry/electron/main';

export type BackgroundTaskStatus =
	| 'enqueued'
	| 'deduped'
	| 'started'
	| 'succeeded'
	| 'failed'
	| 'skipped'
	| 'cancelled';

export interface BackgroundTaskEvent {
	status: BackgroundTaskStatus;
	name: string;
	scope?: string;
	key: string;
	trigger?: string;
	durationMs?: number;
	queueDelayMs?: number;
	error?: unknown;
}

export interface BackgroundTaskContext {
	signal: AbortSignal;
}

export interface BackgroundTaskOptions {
	name: string;
	scope?: string;
	dedupeKey?: string;
	trigger?: string;
	delayMs?: number;
	concurrencyGroup?: string;
	requiresRunning?: () => boolean;
	run: ( context: BackgroundTaskContext ) => Promise< void >;
}

interface QueuedTask {
	key: string;
	options: BackgroundTaskOptions;
	controller: AbortController;
	enqueuedAt: number;
	timer: ReturnType< typeof setTimeout > | null;
	promise: Promise< void >;
	resolve: () => void;
	reject: ( error: unknown ) => void;
}

export interface BackgroundTaskSchedulerOptions {
	onEvent?: ( event: BackgroundTaskEvent ) => void;
	now?: () => number;
}

export class BackgroundTaskScheduler {
	private tasks = new Map< string, QueuedTask >();
	private runningGroups = new Set< string >();
	private groupQueues = new Map< string, QueuedTask[] >();
	private readonly onEvent?: ( event: BackgroundTaskEvent ) => void;
	private readonly now: () => number;

	constructor( options: BackgroundTaskSchedulerOptions = {} ) {
		this.onEvent = options.onEvent;
		this.now = options.now ?? ( () => Date.now() );
	}

	enqueue( options: BackgroundTaskOptions ): Promise< void > {
		const key = this.getTaskKey( options );
		const existing = this.tasks.get( key );
		if ( existing ) {
			this.emit( { status: 'deduped', ...this.eventBase( existing ) } );
			return existing.promise;
		}

		const controller = new AbortController();
		let resolve!: () => void;
		let reject!: ( error: unknown ) => void;
		const promise = new Promise< void >( ( promiseResolve, promiseReject ) => {
			resolve = promiseResolve;
			reject = promiseReject;
		} );

		const task: QueuedTask = {
			key,
			options,
			controller,
			enqueuedAt: this.now(),
			timer: null,
			promise,
			resolve,
			reject,
		};

		this.tasks.set( key, task );
		this.emit( { status: 'enqueued', ...this.eventBase( task ) } );

		const delayMs = options.delayMs ?? 0;
		if ( delayMs > 0 ) {
			task.timer = setTimeout( () => this.startTask( task ), delayMs );
		} else {
			this.startTask( task );
		}

		return promise;
	}

	cancel(
		keyOrOptions: string | Pick< BackgroundTaskOptions, 'name' | 'scope' | 'dedupeKey' >
	): boolean {
		const key = typeof keyOrOptions === 'string' ? keyOrOptions : this.getTaskKey( keyOrOptions );
		const task = this.tasks.get( key );
		if ( ! task ) {
			return false;
		}

		if ( task.timer ) {
			clearTimeout( task.timer );
		}
		this.removeFromGroupQueue( task );
		task.controller.abort();
		this.tasks.delete( key );
		this.emit( { status: 'cancelled', ...this.eventBase( task ) } );
		task.resolve();
		return true;
	}

	getPendingCount(): number {
		return this.tasks.size;
	}

	private startTask( task: QueuedTask ): void {
		task.timer = null;
		const group = task.options.concurrencyGroup;
		if ( group && this.runningGroups.has( group ) ) {
			const queue = this.groupQueues.get( group ) ?? [];
			queue.push( task );
			this.groupQueues.set( group, queue );
			return;
		}

		if ( group ) {
			this.runningGroups.add( group );
		}

		void this.runTask( task );
	}

	private async runTask( task: QueuedTask ): Promise< void > {
		if ( task.controller.signal.aborted ) {
			this.tasks.delete( task.key );
			this.releaseConcurrencyGroup( task );
			task.resolve();
			return;
		}

		if ( task.options.requiresRunning && ! task.options.requiresRunning() ) {
			this.tasks.delete( task.key );
			this.releaseConcurrencyGroup( task );
			this.emit( { status: 'skipped', ...this.eventBase( task ) } );
			task.resolve();
			return;
		}

		const startedAt = this.now();
		this.emit( {
			status: 'started',
			...this.eventBase( task ),
			queueDelayMs: startedAt - task.enqueuedAt,
		} );

		try {
			await task.options.run( { signal: task.controller.signal } );
			this.emit( {
				status: 'succeeded',
				...this.eventBase( task ),
				durationMs: this.now() - startedAt,
			} );
			task.resolve();
		} catch ( error ) {
			Sentry.captureException( error );
			this.emit( {
				status: 'failed',
				...this.eventBase( task ),
				durationMs: this.now() - startedAt,
				error,
			} );
			task.reject( error );
		} finally {
			this.tasks.delete( task.key );
			this.releaseConcurrencyGroup( task );
		}
	}

	private releaseConcurrencyGroup( task: QueuedTask ): void {
		const group = task.options.concurrencyGroup;
		if ( ! group ) {
			return;
		}

		const queue = this.groupQueues.get( group );
		const next = queue?.shift();
		if ( queue && queue.length === 0 ) {
			this.groupQueues.delete( group );
		}

		if ( next ) {
			void this.runTask( next );
			return;
		}

		this.runningGroups.delete( group );
	}

	private removeFromGroupQueue( task: QueuedTask ): void {
		const group = task.options.concurrencyGroup;
		if ( ! group ) {
			return;
		}

		const queue = this.groupQueues.get( group );
		if ( ! queue ) {
			return;
		}

		const nextQueue = queue.filter( ( queuedTask ) => queuedTask !== task );
		if ( nextQueue.length === 0 ) {
			this.groupQueues.delete( group );
			return;
		}

		this.groupQueues.set( group, nextQueue );
	}

	private getTaskKey(
		options: Pick< BackgroundTaskOptions, 'name' | 'scope' | 'dedupeKey' >
	): string {
		return options.dedupeKey ?? [ options.scope, options.name ].filter( Boolean ).join( ':' );
	}

	private eventBase( task: QueuedTask ) {
		return {
			name: task.options.name,
			scope: task.options.scope,
			key: task.key,
			trigger: task.options.trigger,
		};
	}

	private emit( event: BackgroundTaskEvent ): void {
		this.onEvent?.( event );
	}
}

export const backgroundTasks = new BackgroundTaskScheduler( {
	onEvent( event ) {
		if ( event.status === 'failed' ) {
			console.error( 'Background task failed', event );
			return;
		}

		console.debug( 'Background task event', event );
	},
} );
