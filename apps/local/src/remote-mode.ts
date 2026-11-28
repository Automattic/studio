import {
	authenticateDeviceToken,
	getRemoteInstanceId,
	redeemPairingCode,
	REMOTE_PROTOCOL_VERSION,
	revokeRemoteDevice,
	type RemoteDevice,
} from '@studio/common/lib/remote-access';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Express, NextFunction, Request, Response, Router } from 'express';

// Remote mode: what a paired phone may reach on the local server. Everything
// here is default-deny, so a route added to the server later stays blocked
// until someone adds it to the list on purpose.

// The only event channels a phone receives: agent output and site status.
export const REMOTE_EVENT_CHANNELS: ReadonlySet< string > = new Set( [ 'agent', 'site-event' ] );

// Paths are relative to the `/api` router.
const REMOTE_ALLOWED_ROUTES: ReadonlyArray< { method: string; pattern: RegExp } > = [
	{ method: 'POST', pattern: /^\/remote\/pair$/ },
	{ method: 'DELETE', pattern: /^\/remote\/devices\/current$/ },
	{ method: 'GET', pattern: /^\/health$/ },
	{ method: 'GET', pattern: /^\/sites$/ },
	// The phone's site preview: a fresh screenshot of a running site, and the
	// stored one of a stopped site.
	{ method: 'POST', pattern: /^\/sites\/[^/]+\/screenshot$/ },
	{ method: 'GET', pattern: /^\/sites\/[^/]+\/thumbnail$/ },
	{ method: 'GET', pattern: /^\/sessions$/ },
	{ method: 'POST', pattern: /^\/sessions$/ },
	{ method: 'GET', pattern: /^\/sessions\/[^/]+$/ },
	{ method: 'POST', pattern: /^\/sessions\/[^/]+\/messages$/ },
	{ method: 'GET', pattern: /^\/runs\/active$/ },
	{ method: 'POST', pattern: /^\/runs\/[^/]+\/interrupt$/ },
	{ method: 'POST', pattern: /^\/runs\/[^/]+\/answer$/ },
	{ method: 'GET', pattern: /^\/events$/ },
];

export function isRemoteRouteAllowed( method: string, path: string ): boolean {
	return REMOTE_ALLOWED_ROUTES.some(
		( route ) => route.method === method.toUpperCase() && route.pattern.test( path )
	);
}

// What a phone learns about a site. The server's own site shape carries the
// admin password and local paths, which a phone has no use for.
export function toRemoteSite( site: { id: string; name: string; running: boolean; url: string } ) {
	return { id: site.id, name: site.name, running: site.running, url: site.url };
}

const REMOTE_PAIR_PATH = '/remote/pair';

export interface RemoteModeInfo {
	// Shown on the phone, usually the computer's name.
	label: string;
	studioVersion: string;
	// How often open event streams are checked against the paired devices.
	streamRecheckMs?: number;
}

// The only body a phone may send to start a turn. Strict, so a field added to
// the server's message route later stays unreachable until it is listed here.
const remoteMessageBodySchema = z.strictObject( {
	prompt: z.string().min( 1 ),
	turnId: z.string().optional(),
} );

const MESSAGE_PATH = /^\/sessions\/[^/]+\/messages$/;

// Mounted on the `/api` router ahead of every route: allowlist first, then the
// device token. Pairing is the one allowed route that needs no token.
export function createRemoteApiGuard() {
	return ( req: Request, res: Response, next: NextFunction ) => {
		if ( ! isRemoteRouteAllowed( req.method, req.path ) ) {
			res.status( 403 ).json( { error: 'Not available in remote mode' } );
			return;
		}
		if ( req.method === 'POST' && req.path === REMOTE_PAIR_PATH ) {
			next();
			return;
		}
		const header = req.headers.authorization ?? '';
		// The auth scheme is case-insensitive (RFC 7235).
		const token = /^bearer /i.test( header ) ? header.slice( 'Bearer '.length ) : '';
		authenticateDeviceToken( token )
			.then( ( device ) => {
				if ( ! device ) {
					res.status( 401 ).json( { error: 'Device is not paired' } );
					return;
				}
				if (
					req.method === 'POST' &&
					MESSAGE_PATH.test( req.path ) &&
					! remoteMessageBodySchema.safeParse( req.body ).success
				) {
					res
						.status( 400 )
						.json( { error: 'Remote mode accepts a text prompt only, without attachments' } );
					return;
				}
				res.locals.remoteDevice = device;
				next();
			} )
			.catch( next );
	};
}

const pairBodySchema = z.object( {
	code: z.string().min( 1 ).max( 64 ),
	deviceName: z.string().trim().min( 1 ).max( 80 ),
	platform: z.enum( [ 'ios', 'android' ] ),
} );

// Calls `close` on each stream whose device `shouldClose` picks. A stream that
// belongs to no device is always closed. Works on a copy, since `close` removes
// the stream from the set being walked.
export function closeStreamsWhere(
	clients: Iterable< Response >,
	shouldClose: ( deviceId: string ) => boolean,
	close: ( client: Response ) => void
): void {
	for ( const client of [ ...clients ] ) {
		const deviceId = ( client.locals.remoteDevice as RemoteDevice | undefined )?.id;
		if ( ! deviceId || shouldClose( deviceId ) ) {
			close( client );
		}
	}
}

// A stream authenticates once, when it opens. This ends the ones whose device
// is no longer paired (revoked, expired), so they stop receiving agent output.
export function closeUnpairedStreams(
	clients: Iterable< Response >,
	pairedIds: ReadonlySet< string >,
	close: ( client: Response ) => void
): void {
	closeStreamsWhere( clients, ( deviceId ) => ! pairedIds.has( deviceId ), close );
}

export function registerRemoteRoutes(
	app: Express,
	api: Router,
	info: RemoteModeInfo,
	onDeviceRevoked: ( deviceId: string ) => void
): void {
	// Read before pairing, so the phone can check which computer answers and
	// whether the two speak the same protocol.
	app.get( '/.well-known/studio/remote', ( _req: Request, res: Response, next: NextFunction ) => {
		getRemoteInstanceId()
			.then( ( instanceId ) => {
				res.json( {
					instanceId,
					label: info.label,
					protocolVersion: REMOTE_PROTOCOL_VERSION,
					studioVersion: info.studioVersion,
				} );
			} )
			.catch( next );
	} );

	api.post(
		REMOTE_PAIR_PATH,
		rateLimit( { windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false } ),
		( req: Request, res: Response, next: NextFunction ) => {
			const parsed = pairBodySchema.safeParse( req.body );
			if ( ! parsed.success ) {
				res.status( 400 ).json( { error: 'code, deviceName and platform are required' } );
				return;
			}
			redeemPairingCode( parsed.data )
				.then( ( paired ) => {
					if ( ! paired ) {
						res.status( 401 ).json( { error: 'Pairing code is not valid' } );
						return;
					}
					res.json( paired );
				} )
				.catch( next );
		}
	);

	api.delete( '/remote/devices/current', ( _req: Request, res: Response, next: NextFunction ) => {
		const device = res.locals.remoteDevice as RemoteDevice;
		revokeRemoteDevice( device.id )
			.then( () => {
				onDeviceRevoked( device.id );
				res.sendStatus( 204 );
			} )
			.catch( next );
	} );
}
