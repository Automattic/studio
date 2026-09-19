import path from 'node:path';

export const APP_ROOT = path.resolve( import.meta.dirname, '../..' );
const REPO_ROOT = path.resolve( APP_ROOT, '../..' );

export interface Config {
	port: number;
	production: boolean;
	/** Persistent storage: job files and the Studio CLI's own state. */
	dataDir: string;
	/** Crawl at most this many URLs per site. */
	maxPages: number;
	concurrency: number;
	maxQueued: number;
	timeoutMs: number;
	retentionMs: number;
	jobsPerHour: number;
	minFreeDiskBytes: number;
	trustProxy: number;
	turnstile?: { siteKey: string; secretKey: string };
	/** Simulate jobs instead of running the real pipeline (UI development). */
	fakePipeline: boolean;
	/** Data-liberation CLI entry point, run through tsx. */
	dlaCli: string;
}

export function loadConfig( env: NodeJS.ProcessEnv = process.env ): Config {
	const number = ( name: string, fallback: number ) => {
		const value = Number( env[ name ] );
		return env[ name ] && Number.isFinite( value ) && value >= 0 ? value : fallback;
	};
	const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim();
	const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim();
	const fakePipeline = env.LIBERATE_FAKE_PIPELINE === '1';
	return {
		port: number( 'PORT', 8080 ),
		production: env.NODE_ENV === 'production',
		dataDir: path.resolve(
			env.LIBERATE_DATA_DIR ||
				env.RAILWAY_VOLUME_MOUNT_PATH ||
				// Keep simulated jobs and their placeholder downloads apart from real ones.
				path.join( APP_ROOT, fakePipeline ? '.data/simulated' : '.data' )
		),
		maxPages: Math.max( 1, number( 'LIBERATE_MAX_PAGES', 100 ) ),
		concurrency: Math.max( 1, number( 'LIBERATE_CONCURRENCY', 1 ) ),
		maxQueued: number( 'LIBERATE_MAX_QUEUED', 20 ),
		timeoutMs: number( 'LIBERATE_TIMEOUT_MINUTES', 60 ) * 60_000,
		retentionMs: number( 'LIBERATE_RETENTION_HOURS', 24 ) * 3_600_000,
		jobsPerHour: number( 'LIBERATE_JOBS_PER_HOUR', 3 ),
		minFreeDiskBytes: number( 'LIBERATE_MIN_FREE_DISK_GB', 1 ) * 1024 ** 3,
		trustProxy: number( 'LIBERATE_TRUST_PROXY', 1 ),
		turnstile:
			turnstileSiteKey && turnstileSecretKey
				? { siteKey: turnstileSiteKey, secretKey: turnstileSecretKey }
				: undefined,
		fakePipeline,
		dlaCli: path.join( REPO_ROOT, 'packages/data-liberation-agent/src/cli.ts' ),
	};
}
