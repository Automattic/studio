import path from 'node:path';

export const APP_ROOT = path.resolve( import.meta.dirname, '../..' );

export interface Config {
	port: number;
	production: boolean;
	/** Where the small per-job records live. */
	dataDir: string;
	retentionMs: number;
	jobsPerHour: number;
	trustProxy: number;
	turnstile?: { siteKey: string; secretKey: string };
	/** Simulate jobs instead of calling WordPress.com (UI development). */
	fakePipeline: boolean;
	/** The registered WordPress.com app that copies sites on liberate.sh's behalf. */
	wpcom?: { clientId: string; clientSecret: string };
	apiBase: string;
}

export function loadConfig( env: NodeJS.ProcessEnv = process.env ): Config {
	const number = ( name: string, fallback: number ) => {
		const value = Number( env[ name ] );
		return env[ name ] && Number.isFinite( value ) && value >= 0 ? value : fallback;
	};
	const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim();
	const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim();
	const fakePipeline = env.LIBERATE_FAKE_PIPELINE === '1';
	const clientId = env.WPCOM_CLIENT_ID?.trim();
	const clientSecret = env.WPCOM_CLIENT_SECRET?.trim();
	return {
		port: number( 'PORT', 8080 ),
		production: env.NODE_ENV === 'production',
		dataDir: path.resolve(
			env.LIBERATE_DATA_DIR ||
				env.RAILWAY_VOLUME_MOUNT_PATH ||
				// Keep simulated jobs and their placeholder downloads apart from real ones.
				path.join( APP_ROOT, fakePipeline ? '.data/simulated' : '.data' )
		),
		// WordPress.com keeps a ready archive for about three days; a link here lasts as long.
		retentionMs: number( 'LIBERATE_RETENTION_HOURS', 72 ) * 3_600_000,
		jobsPerHour: number( 'LIBERATE_JOBS_PER_HOUR', 3 ),
		trustProxy: number( 'LIBERATE_TRUST_PROXY', 1 ),
		turnstile:
			turnstileSiteKey && turnstileSecretKey
				? { siteKey: turnstileSiteKey, secretKey: turnstileSecretKey }
				: undefined,
		fakePipeline,
		wpcom: clientId && clientSecret ? { clientId, clientSecret } : undefined,
		apiBase: ( env.WPCOM_API_BASE?.trim() || 'https://public-api.wordpress.com' ).replace(
			/\/$/,
			''
		),
	};
}
