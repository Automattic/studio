import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { isJobId, type PublicConfig } from '../shared.ts';
import { APP_ROOT, type Config } from './config.ts';
import { assertPublicHost, parseSiteUrl, UserError, verifyTurnstile } from './guards.ts';
import { asUserError, fetchTitle, siteNameFrom, viewFrom, type PreviewClient } from './wpcom.ts';
import type { JobStore } from './store.ts';

type Log = ( event: string, data: Record< string, unknown > ) => void;

interface AppOptions {
	config: Config;
	store: JobStore;
	client: PreviewClient;
	log: Log;
	/** Injectable for tests. */
	checkHost?: ( hostname: string ) => Promise< void >;
}

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
	store,
	client,
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
		res.json( { ok: true } );
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

				// The headline wants the site's own name, and a title that never arrives costs nothing.
				const siteName = await fetchTitle( url.href )
					.then( siteNameFrom )
					.catch( () => undefined );
				const session = await client.create( url.href ).catch( ( error ) => {
					log( 'create_failed', { host: url.hostname, error: String( error ) } );
					throw asUserError( error );
				} );

				const now = Date.now();
				const record = {
					id: session.session_id,
					url: url.href,
					host: url.hostname,
					siteName,
					createdAt: now,
					expiresAt: now + config.retentionMs,
				};
				await store.put( record );
				log( 'job_created', { id: record.id, host: record.host } );
				res.status( 201 ).json( viewFrom( record, session ) );
			} catch ( error ) {
				next( error );
			}
		}
	);

	/** Read the session behind a job, or answer for a link that no longer resolves. */
	const load = async ( id: string ) => {
		const record = isJobId( id ) ? await store.get( id ) : undefined;
		if ( ! record ) {
			throw new UserError( 'This link has expired or never existed.', 404 );
		}
		return {
			record,
			session: await client.status( id ).catch( ( error ) => {
				throw asUserError( error );
			} ),
		};
	};

	api.get( '/jobs/:id', async ( req, res, next ) => {
		try {
			const { record, session } = await load( req.params.id );
			// The size is worth one extra request, once, so the button can promise a number.
			if ( ! record.bytes && session.archive_url ) {
				record.bytes = await client.sizeOf( session.archive_url );
				if ( record.bytes ) {
					await store.put( record );
				}
			}
			res.set( 'Cache-Control', 'no-store' ).json( viewFrom( record, session ) );
		} catch ( error ) {
			next( error );
		}
	} );

	api.get( '/jobs/:id/files/site', async ( req, res, next ) => {
		try {
			const { record, session } = await load( req.params.id );
			if ( ! session.archive_url ) {
				throw new UserError( 'This file isn’t available.', 404 );
			}
			log( 'download', { id: record.id } );
			// Signed and short-lived, which is why it is read fresh on every click.
			res.redirect( 302, session.archive_url );
		} catch ( error ) {
			next( error );
		}
	} );

	if ( config.fakePipeline ) {
		api.get( '/simulated.zip', ( _req, res ) => {
			res
				.type( 'application/zip' )
				.send( 'A placeholder from a simulated liberate.sh run (LIBERATE_FAKE_PIPELINE=1).\n' );
		} );
	}

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
