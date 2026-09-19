import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { UserError } from './guards.ts';
import type { FileKind, JobCounts, JobView, Step } from '../shared.ts';

export interface JobRecord extends JobView {
	attempts: number;
	/** Opaque per-visitor key, used to allow one active job per visitor. */
	client?: string;
	startedAt?: number;
	finishedAt?: number;
}

export interface JobProgress {
	siteName?: string;
	platform?: string;
	step?: Step;
	progress?: number;
	detail?: string;
	counts?: JobCounts;
}

export interface JobResult {
	siteName?: string;
	platform?: string;
	counts: JobCounts;
	truncated: boolean;
	files: Partial< Record< FileKind, number > >;
}

export interface RunContext {
	/** Empty working directory owned by this run. */
	workDir: string;
	/** Where the runner must write the `<kind>.zip` downloads. */
	filesDir: string;
	signal: AbortSignal;
	report: ( progress: JobProgress ) => void;
}

export type Runner = ( job: JobRecord, context: RunContext ) => Promise< JobResult >;

export interface QueueOptions {
	/** Directory holding one sub-directory per job. */
	dir: string;
	run: Runner;
	concurrency: number;
	maxQueued: number;
	timeoutMs: number;
	retentionMs: number;
	log?: ( event: string, data: Record< string, unknown > ) => void;
}

const MAX_ATTEMPTS = 2;
const FAILURE_MESSAGE = 'Something went wrong while liberating this site. Please try again later.';

function toView( job: JobRecord ): JobView {
	const { attempts: _a, client: _c, startedAt: _s, finishedAt: _f, ...view } = job;
	return view;
}

export class JobQueue extends EventEmitter {
	private readonly options: QueueOptions;
	private readonly jobs = new Map< string, JobRecord >();
	private readonly running = new Map<
		string,
		{ controller: AbortController; done: Promise< void > }
	>();
	private readonly saves = new Map< string, Promise< void > >();
	private closing = false;

	constructor( options: QueueOptions ) {
		super();
		this.setMaxListeners( 0 );
		this.options = options;
	}

	/** Load persisted jobs. Jobs interrupted by a restart are queued again, from scratch. */
	async load() {
		await fs.mkdir( this.options.dir, { recursive: true } );
		for ( const id of await fs.readdir( this.options.dir ) ) {
			let job: JobRecord;
			try {
				job = JSON.parse( await fs.readFile( this.jobFile( id ), 'utf8' ) );
			} catch {
				await fs.rm( path.join( this.options.dir, id ), { recursive: true, force: true } );
				continue;
			}
			if ( job.status === 'running' ) {
				Object.assign(
					job,
					job.attempts < MAX_ATTEMPTS
						? { status: 'queued', progress: 0, step: undefined, detail: undefined }
						: this.failure( FAILURE_MESSAGE )
				);
				await this.save( job );
			}
			this.jobs.set( job.id, job );
		}
		this.pump();
	}

	create( url: string, client?: string ): JobView {
		if ( this.closing ) {
			throw new UserError( 'liberate.sh is restarting. Please try again in a minute.', 503 );
		}
		if ( this.list( 'queued' ).length >= this.options.maxQueued ) {
			throw new UserError( 'liberate.sh is very busy right now. Please try again later.', 503 );
		}
		if ( client && this.hasActive( client ) ) {
			throw new UserError(
				'You already have a site being liberated. Wait for it to finish first.',
				429
			);
		}
		const job: JobRecord = {
			id: randomBytes( 16 ).toString( 'base64url' ),
			url,
			host: new URL( url ).hostname,
			status: 'queued',
			progress: 0,
			createdAt: Date.now(),
			attempts: 0,
			client,
		};
		this.jobs.set( job.id, job );
		this.persist( job );
		this.options.log?.( 'job_created', { id: job.id, host: job.host } );
		this.pump();
		return this.view( job.id )!;
	}

	get( id: string ): JobRecord | undefined {
		return this.jobs.get( id );
	}

	view( id: string ): JobView | undefined {
		const job = this.jobs.get( id );
		if ( ! job ) {
			return undefined;
		}
		const view = toView( job );
		if ( job.status === 'queued' ) {
			view.queuePosition = this.list( 'queued' ).indexOf( job ) + 1;
		}
		return view;
	}

	filePath( id: string, kind: FileKind ): string {
		return path.join( this.options.dir, id, 'files', `${ kind }.zip` );
	}

	hasActive( client: string ): boolean {
		return [ ...this.jobs.values() ].some(
			( job ) => job.client === client && ( job.status === 'queued' || job.status === 'running' )
		);
	}

	stats() {
		return { queued: this.list( 'queued' ).length, running: this.running.size };
	}

	/** Delete finished jobs whose retention period is over. */
	async sweep( now = Date.now() ) {
		for ( const job of this.jobs.values() ) {
			if ( job.expiresAt && job.expiresAt <= now ) {
				this.jobs.delete( job.id );
				await this.saves.get( job.id );
				this.saves.delete( job.id );
				await fs.rm( path.join( this.options.dir, job.id ), { recursive: true, force: true } );
				this.options.log?.( 'job_expired', { id: job.id } );
			}
		}
	}

	/** Stop accepting work and abort running jobs; they start over after the restart. */
	async shutdown( graceMs = 10_000 ) {
		this.closing = true;
		const running = [ ...this.running.values() ];
		running.forEach( ( { controller } ) => controller.abort( 'shutdown' ) );
		await Promise.race( [
			Promise.allSettled( running.map( ( { done } ) => done ) ),
			new Promise( ( resolve ) => setTimeout( resolve, graceMs ).unref() ),
		] );
		await Promise.allSettled( this.saves.values() );
	}

	private list( status: JobRecord[ 'status' ] ): JobRecord[] {
		return [ ...this.jobs.values() ]
			.filter( ( job ) => job.status === status )
			.sort( ( a, b ) => a.createdAt - b.createdAt );
	}

	private pump() {
		if ( this.closing ) {
			return;
		}
		const next = this.list( 'queued' ).slice(
			0,
			Math.max( 0, this.options.concurrency - this.running.size )
		);
		for ( const job of next ) {
			const controller = new AbortController();
			this.running.set( job.id, { controller, done: this.start( job, controller ) } );
		}
		if ( next.length ) {
			// Everyone still waiting moved up in line.
			for ( const job of this.list( 'queued' ) ) {
				this.emit( 'update', this.view( job.id ) );
			}
		}
	}

	private async start( job: JobRecord, controller: AbortController ) {
		const jobDir = path.join( this.options.dir, job.id );
		const workDir = path.join( jobDir, 'work' );
		const filesDir = path.join( jobDir, 'files' );
		Object.assign( job, {
			status: 'running',
			progress: 0,
			attempts: job.attempts + 1,
			startedAt: Date.now(),
		} );
		this.persist( job );
		this.options.log?.( 'job_started', { id: job.id, host: job.host, attempt: job.attempts } );

		const signal = AbortSignal.any( [
			controller.signal,
			AbortSignal.timeout( this.options.timeoutMs ),
		] );
		const shutdown = () => controller.signal.reason === 'shutdown';
		try {
			await fs.rm( workDir, { recursive: true, force: true } );
			await fs.rm( filesDir, { recursive: true, force: true } );
			await fs.mkdir( workDir, { recursive: true } );
			await fs.mkdir( filesDir, { recursive: true } );
			signal.throwIfAborted();
			const result = await this.options.run( job, {
				workDir,
				filesDir,
				signal,
				report: ( progress ) => {
					if ( ! signal.aborted ) {
						this.persist( Object.assign( job, progress ) );
					}
				},
			} );
			signal.throwIfAborted();
			Object.assign( job, result, {
				status: 'done',
				progress: 1,
				step: undefined,
				detail: undefined,
				finishedAt: Date.now(),
				expiresAt: Date.now() + this.options.retentionMs,
			} );
			this.options.log?.( 'job_done', {
				id: job.id,
				host: job.host,
				ms: job.finishedAt! - job.startedAt!,
				...result.counts,
				truncated: result.truncated,
			} );
		} catch ( error ) {
			if ( shutdown() ) {
				// A deploy or restart isn't the job's fault, so it doesn't use up an attempt. The job
				// stays marked as running, and `load()` queues it again after the restart.
				job.attempts--;
				this.persist( job );
				return;
			}
			const timedOut = signal.aborted && ! controller.signal.aborted;
			const minutes = Math.round( this.options.timeoutMs / 60_000 );
			Object.assign(
				job,
				this.failure(
					timedOut
						? `This site took longer than ${ minutes } minutes to liberate, so we stopped.`
						: error instanceof UserError
						? error.message
						: FAILURE_MESSAGE
				)
			);
			this.options.log?.( 'job_failed', {
				id: job.id,
				host: job.host,
				timedOut,
				error: error instanceof Error ? error.message : String( error ),
			} );
		} finally {
			this.running.delete( job.id );
			if ( ! shutdown() ) {
				await fs.rm( workDir, { recursive: true, force: true } ).catch( () => undefined );
				this.persist( job );
				this.pump();
			}
		}
	}

	private failure( error: string ): Partial< JobRecord > {
		return {
			status: 'failed',
			error,
			step: undefined,
			detail: undefined,
			finishedAt: Date.now(),
			expiresAt: Date.now() + this.options.retentionMs,
		};
	}

	private jobFile( id: string ) {
		return path.join( this.options.dir, id, 'job.json' );
	}

	/** Notify listeners and write the job to disk, in order, without blocking the caller. */
	private persist( job: JobRecord ) {
		this.emit( 'update', this.view( job.id ) );
		const previous = this.saves.get( job.id ) ?? Promise.resolve();
		this.saves.set(
			job.id,
			previous
				.then( () => this.save( job ) )
				.catch(
					( error ) =>
						this.options.log?.( 'job_save_failed', { id: job.id, error: String( error ) } )
				)
		);
	}

	private async save( job: JobRecord ) {
		const file = this.jobFile( job.id );
		await fs.mkdir( path.dirname( file ), { recursive: true } );
		const temp = `${ file }.${ randomBytes( 4 ).toString( 'hex' ) }.tmp`;
		await fs.writeFile( temp, JSON.stringify( job ) );
		await fs.rename( temp, file );
	}
}
