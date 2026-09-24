import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { isJobId, type FileKind, type JobView, type PublicConfig } from '../shared.ts';
import { APP_ROOT, type Config } from './config.ts';
import { assertPublicHost, parseSiteUrl, UserError, verifyTurnstile } from './guards.ts';
import type { JobQueue } from './jobs.ts';

type Log = ( event: string, data: Record< string, unknown > ) => void;

interface AppOptions {
	config: Config;
	queue: JobQueue;
	log: Log;
	/** Injectable for tests. */
	checkHost?: ( hostname: string ) => Promise< void >;
}

const FILE_NAMES: Record< FileKind, ( host: string ) => string > = {
	site: ( host ) => `${ host }-wordpress.zip`,
};

const CSP = [
	"default-src 'self'",
	"script-src 'self' https://challenges.cloudflare.com",
	'frame-src https://challenges.cloudflare.com',
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"connect-src 'self'",
	"base-uri 'none'",
	"form-action 'self'",
	"frame-ancestors 'none'",
].join( '; ' );

export async function createApp( {
	config,
	queue,
	log,
	checkHost = assertPublicHost,
}: AppOptions ) {
	const app = express();
	app.disable( 'x-powered-by' );
	app.set( 'trust proxy', config.trustProxy );

	app.use( ( _req, res, next ) => {
		res.set( {
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'strict-origin-when-cross-origin',
			'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
		} );
		if ( config.production ) {
			res.set( {
				'Content-Security-Policy': CSP,
				'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
			} );
		}
		next();
	} );

	app.get( '/healthz', ( _req, res ) => {
		res.json( { ok: true, ...queue.stats() } );
	} );

	const api = express.Router();
	api.use( express.json( { limit: '4kb' } ) );
	api.use(
		rateLimit( {
			windowMs: 15 * 60_000,
			limit: 600,
			standardHeaders: 'draft-8',
			legacyHeaders: false,
		} )
	);

	api.get( '/config', ( _req, res ) => {
		const body: PublicConfig = {
			retentionHours: Math.round( config.retentionMs / 3_600_000 ),
			turnstileSiteKey: config.turnstile?.siteKey,
			simulated: config.fakePipeline || undefined,
		};
		res.json( body );
	} );

	const salt = randomBytes( 16 );
	const clientKey = ( req: Request ) =>
		createHash( 'sha256' )
			.update( salt )
			.update( req.ip ?? '' )
			.digest( 'base64url' )
			.slice( 0, 16 );

	api.post(
		'/jobs',
		rateLimit( {
			windowMs: 60 * 60_000,
			limit: config.jobsPerHour,
			skipFailedRequests: true,
			standardHeaders: 'draft-8',
			legacyHeaders: false,
			message: { error: 'You’ve liberated several sites already. Please try again in an hour.' },
		} ),
		async ( req, res, next ) => {
			try {
				const { url: input, consent, turnstileToken } = req.body ?? {};
				if ( consent !== true ) {
					throw new UserError( 'Please confirm that you own this site or may copy it.' );
				}
				const url = parseSiteUrl( input );
				if (
					config.turnstile &&
					! ( await verifyTurnstile( config.turnstile.secretKey, turnstileToken, req.ip ) )
				) {
					throw new UserError( 'We couldn’t verify that you’re human. Please try again.', 403 );
				}
				await checkHost( url.hostname );
				const { bavail, bsize } = await fs.promises.statfs( config.dataDir );
				if ( bavail * bsize < config.minFreeDiskBytes ) {
					log( 'disk_low', { free: bavail * bsize } );
					throw new UserError(
						'liberate.sh is out of room right now. Please try again later.',
						503
					);
				}
				res.status( 201 ).json( queue.create( url.href, clientKey( req ) ) );
			} catch ( error ) {
				next( error );
			}
		}
	);

	api.param( 'id', ( _req, res, next, id: string ) => {
		if ( isJobId( id ) && queue.get( id ) ) {
			next();
		} else {
			res.status( 404 ).json( { error: 'This link has expired or never existed.' } );
		}
	} );

	api.get( '/jobs/:id', ( req, res ) => {
		res.set( 'Cache-Control', 'no-store' ).json( queue.view( req.params.id ) );
	} );

	api.get( '/jobs/:id/events', ( req, res ) => {
		const { id } = req.params;
		res.set( {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		} );
		res.flushHeaders();
		const send = ( view: JobView | undefined ) => {
			if ( view?.id === id ) {
				res.write( `data: ${ JSON.stringify( view ) }\n\n` );
			}
		};
		send( queue.view( id ) );
		queue.on( 'update', send );
		const ping = setInterval( () => res.write( ': ping\n\n' ), 20_000 );
		req.on( 'close', () => {
			clearInterval( ping );
			queue.off( 'update', send );
		} );
	} );

	api.get( '/jobs/:id/files/:kind', ( req, res, next ) => {
		const job = queue.get( req.params.id )!;
		const kind = req.params.kind as FileKind;
		if ( job.status !== 'done' || ! Object.hasOwn( FILE_NAMES, kind ) || ! job.files?.[ kind ] ) {
			res.status( 404 ).json( { error: 'This file isn’t available.' } );
			return;
		}
		log( 'download', { id: job.id, kind } );
		res.download( queue.filePath( job.id, kind ), FILE_NAMES[ kind ]( job.host ), ( error ) => {
			if ( error && ! res.headersSent ) {
				next( error );
			}
		} );
	} );

	app.use( '/api', api );

	if ( config.production ) {
		const dist = path.join( APP_ROOT, 'dist' );
		app.use(
			'/assets',
			express.static( path.join( dist, 'assets' ), { immutable: true, maxAge: '1y' } )
		);
		app.use( express.static( dist, { index: false } ) );
		app.get( [ '/', '/j/:id' ], ( _req, res ) => {
			res.set( 'Cache-Control', 'no-cache' ).sendFile( path.join( dist, 'index.html' ) );
		} );
	} else {
		const { createServer } = await import( 'vite' );
		const vite = await createServer( {
			root: APP_ROOT,
			server: { middlewareMode: true },
			appType: 'spa',
			// The default loader imports a temporary copy of the config and deletes it, which
			// `node --watch` (npm run dev) takes as a change: the server would restart in a loop.
			configLoader: 'native',
		} );
		app.use( vite.middlewares );
	}

	const errorHandler: ErrorRequestHandler = ( error, req, res, _next ) => {
		if ( error instanceof UserError ) {
			res.status( error.status ).json( { error: error.message } );
			return;
		}
		if ( error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large' ) {
			res.status( 400 ).json( { error: 'Invalid request.' } );
			return;
		}
		log( 'request_failed', { path: req.path, error: String( error?.stack ?? error ) } );
		res.status( 500 ).json( { error: 'Something went wrong. Please try again.' } );
	};
	app.use( errorHandler );

	return app;
}
