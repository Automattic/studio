import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { LOCKFILE_WAIT_TIME, REMOTE_ACCESS_LOCKFILE_NAME } from '../constants';
import { hideDirectoryOnWindows } from './hide-dir-windows';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import { REMOTE_CONNECTION_KINDS, type RemoteConnectionKind } from './remote-connection';
import { getConfigDirectory, getRemoteAccessConfigPath } from './well-known-paths';

// What `studio remote` and paired phones agree on. Bump it when a change to the
// remote routes or their payloads would break a phone built for the old ones.
export const REMOTE_PROTOCOL_VERSION = 1;

export const PAIRING_CODE_LENGTH = 12;
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const PAIRING_MAX_FAILED_ATTEMPTS = 5;
export const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Crockford base32: no I, L, O or U, so nothing reads as another character.
const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type RemoteDevicePlatform = 'ios' | 'android';

const REMOTE_ACCESS_VERSION = 1;

const pairingCodeSchema = z
	.object( {
		codeHash: z.string(),
		expiresAt: z.number(),
		failedAttempts: z.number(),
	} )
	.loose();

const storedDeviceSchema = z
	.object( {
		id: z.string(),
		name: z.string(),
		platform: z.string(),
		tokenHash: z.string(),
		pairedAt: z.number(),
		lastSeenAt: z.number(),
		expiresAt: z.number(),
	} )
	.loose();

const serverInfoSchema = z
	.object( {
		url: z.string(),
		pid: z.number(),
		startedAt: z.number(),
		// Missing in records from builds before the connection options.
		connection: z.enum( REMOTE_CONNECTION_KINDS ).optional(),
		// Why Automatic did not take a safer connection, when it did not.
		fallbackReason: z.string().optional(),
	} )
	.loose();

const remoteAccessSchema = z
	.object( {
		version: z.literal( REMOTE_ACCESS_VERSION ),
		instanceId: z.string(),
		pairingCodes: z.array( pairingCodeSchema ),
		devices: z.array( storedDeviceSchema ),
		server: serverInfoSchema.optional(),
	} )
	.loose();

export class RemoteAccessVersionMismatchError extends Error {
	constructor() {
		super(
			'A newer version of Studio or the Studio CLI wrote the remote access file. Please update all components to the same version.'
		);
		this.name = 'RemoteAccessVersionMismatchError';
	}
}

export type RemoteAccessState = z.infer< typeof remoteAccessSchema >;
export type RemoteServerInfo = z.infer< typeof serverInfoSchema >;

function emptyState(): RemoteAccessState {
	return {
		version: REMOTE_ACCESS_VERSION,
		instanceId: randomUUID(),
		pairingCodes: [],
		devices: [],
	};
}

async function readStoredRemoteAccess(): Promise< RemoteAccessState | null > {
	const configPath = getRemoteAccessConfigPath();
	if ( ! fs.existsSync( configPath ) ) {
		return null;
	}
	let data: unknown;
	try {
		const content = await readFile( configPath, { encoding: 'utf8' } );
		data = JSON.parse( content );
		return remoteAccessSchema.parse( data );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			const version = ( data as { version?: unknown } | null )?.version;
			if ( typeof version === 'number' && version !== REMOTE_ACCESS_VERSION ) {
				throw new RemoteAccessVersionMismatchError();
			}
			return null;
		}
		if ( error instanceof SyntaxError ) {
			return null;
		}
		// Anything else, such as an I/O error, must not read as empty: the next update would wipe the file.
		throw error;
	}
}

// A missing or unreadable file reads as empty: no device is paired. The `instanceId` of an empty
// state is a throwaway, so callers must use `getRemoteInstanceId()`.
export async function readRemoteAccess(): Promise< RemoteAccessState > {
	return ( await readStoredRemoteAccess() ) ?? emptyState();
}

// `mutate` must be synchronous: the state is written as soon as it returns.
export async function updateRemoteAccess< T >(
	mutate: ( state: RemoteAccessState ) => T,
	{ wait = LOCKFILE_WAIT_TIME }: { wait?: number } = {}
): Promise< T > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}
	const lockPath = path.join( configDir, REMOTE_ACCESS_LOCKFILE_NAME );
	await lockFileAsync( lockPath, { wait } );
	try {
		const state = await readRemoteAccess();
		const result = mutate( state );
		// A state that would read back as empty must fail here, not wipe the file.
		remoteAccessSchema.parse( state );
		await writeFile( getRemoteAccessConfigPath(), JSON.stringify( state, null, 2 ) + '\n', {
			encoding: 'utf8',
			mode: 0o600,
		} );
		return result;
	} finally {
		await unlockFileAsync( lockPath );
	}
}

// Stable id of this Studio install, so a phone can tell two computers apart.
export async function getRemoteInstanceId(): Promise< string > {
	const stored = await readStoredRemoteAccess();
	if ( stored ) {
		return stored.instanceId;
	}
	return updateRemoteAccess( ( state ) => state.instanceId );
}

function sha256( value: string ): string {
	return createHash( 'sha256' ).update( value ).digest( 'hex' );
}

function hashesMatch( a: string, b: string ): boolean {
	const left = Buffer.from( a, 'hex' );
	const right = Buffer.from( b, 'hex' );
	return left.length === right.length && timingSafeEqual( left, right );
}

function normalizePairingCode( code: string ): string {
	// Crockford decoding: O reads as 0, and I and L read as 1.
	return code.replace( /[\s-]/g, '' ).toUpperCase().replace( /O/g, '0' ).replace( /[IL]/g, '1' );
}

export function formatPairingCode( code: string ): string {
	return code.match( /.{1,4}/g )?.join( '-' ) ?? code;
}

export async function createPairingCode(
	now = Date.now()
): Promise< { code: string; expiresAt: number } > {
	let code = '';
	for ( let index = 0; index < PAIRING_CODE_LENGTH; index += 1 ) {
		code += PAIRING_CODE_ALPHABET[ randomInt( PAIRING_CODE_ALPHABET.length ) ];
	}
	const expiresAt = now + PAIRING_CODE_TTL_MS;
	await updateRemoteAccess( ( state ) => {
		state.pairingCodes = state.pairingCodes.filter( ( entry ) => entry.expiresAt > now );
		state.pairingCodes.push( { codeHash: sha256( code ), expiresAt, failedAttempts: 0 } );
	} );
	return { code, expiresAt };
}

// Codes outlive the server that printed them, so remote mode drops the open ones
// when it starts and when it stops.
export async function clearPairingCodes(): Promise< void > {
	await updateRemoteAccess( ( state ) => {
		state.pairingCodes = [];
	} );
}

// Drops one code before it expires: a newer one took its place on screen.
export async function revokePairingCode( code: string ): Promise< void > {
	const codeHash = sha256( normalizePairingCode( code ) );
	await updateRemoteAccess( ( state ) => {
		state.pairingCodes = state.pairingCodes.filter( ( entry ) => entry.codeHash !== codeHash );
	} );
}

export interface PairedDevice {
	token: string;
	deviceId: string;
	expiresAt: number;
}

// A wrong code counts against every code that is still open, so guessing
// burns the real one. Returns null when the code is wrong, used or expired.
export async function redeemPairingCode(
	input: { code: string; deviceName: string; platform: RemoteDevicePlatform },
	now = Date.now()
): Promise< PairedDevice | null > {
	// With no open code a guess cannot count against anything, so it must not take the lock.
	const current = await readRemoteAccess();
	if ( ! current.pairingCodes.some( ( entry ) => entry.expiresAt > now ) ) {
		return null;
	}
	return updateRemoteAccess( ( state ) => {
		state.pairingCodes = state.pairingCodes.filter( ( entry ) => entry.expiresAt > now );
		const codeHash = sha256( normalizePairingCode( input.code ) );
		const index = state.pairingCodes.findIndex( ( entry ) =>
			hashesMatch( entry.codeHash, codeHash )
		);
		if ( index === -1 ) {
			for ( const entry of state.pairingCodes ) {
				entry.failedAttempts += 1;
			}
			state.pairingCodes = state.pairingCodes.filter(
				( entry ) => entry.failedAttempts < PAIRING_MAX_FAILED_ATTEMPTS
			);
			return null;
		}
		state.pairingCodes.splice( index, 1 );

		const token = randomBytes( 32 ).toString( 'base64url' );
		const device = {
			id: randomUUID(),
			name: input.deviceName
				.replace( /[\p{Cc}\p{Cf}]/gu, '' )
				.trim()
				.slice( 0, 80 ),
			platform: input.platform,
			tokenHash: sha256( token ),
			pairedAt: now,
			lastSeenAt: now,
			expiresAt: now + DEVICE_TOKEN_TTL_MS,
		};
		state.devices = state.devices.filter( ( entry ) => entry.expiresAt > now );
		state.devices.push( device );
		return { token, deviceId: device.id, expiresAt: device.expiresAt };
	} );
}

// Named fields only: the stored schema is loose, so a spread would carry the
// token hash and any field a newer build added.
export interface RemoteDevice {
	id: string;
	name: string;
	platform: string;
	pairedAt: number;
	lastSeenAt: number;
	expiresAt: number;
}

// Writing on every request would rewrite the file constantly.
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;
const LAST_SEEN_LOCK_WAIT_MS = 2_000;

// When this process last started a last-seen write, per device. Concurrent requests that read the
// same stale value would otherwise each queue a write behind the lock.
const lastSeenWrites = new Map< string, number >();

function toRemoteDevice( stored: z.infer< typeof storedDeviceSchema > ): RemoteDevice {
	return {
		id: stored.id,
		name: stored.name,
		platform: stored.platform,
		pairedAt: stored.pairedAt,
		lastSeenAt: stored.lastSeenAt,
		expiresAt: stored.expiresAt,
	};
}

// Reads the file each time, so a revoke from another process applies at once.
export async function authenticateDeviceToken(
	token: string,
	now = Date.now()
): Promise< RemoteDevice | null > {
	if ( ! token ) {
		return null;
	}
	const tokenHash = sha256( token );
	const state = await readRemoteAccess();
	const stored = state.devices.find( ( entry ) => hashesMatch( entry.tokenHash, tokenHash ) );
	if ( ! stored || stored.expiresAt <= now ) {
		return null;
	}
	const lastWriteStart = lastSeenWrites.get( stored.id );
	if (
		now - stored.lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS &&
		( lastWriteStart === undefined || now - lastWriteStart >= LAST_SEEN_WRITE_INTERVAL_MS )
	) {
		lastSeenWrites.set( stored.id, now );
		try {
			const found = await updateRemoteAccess(
				( current ) => {
					const entry = current.devices.find( ( candidate ) => candidate.id === stored.id );
					if ( entry ) {
						entry.lastSeenAt = Math.max( entry.lastSeenAt, now );
					}
					return !! entry;
				},
				// The lock keeps trying when it cannot be taken at all, as in a
				// read-only config folder: a request waits this long, then the
				// token still works.
				{ wait: LAST_SEEN_LOCK_WAIT_MS }
			);
			if ( ! found ) {
				// Revoked while this request waited for the lock.
				return null;
			}
		} catch {
			// A failed bookkeeping write must not fail a valid token.
			return toRemoteDevice( stored );
		}
		return toRemoteDevice( { ...stored, lastSeenAt: now } );
	}
	return toRemoteDevice( stored );
}

export async function listRemoteDevices( now = Date.now() ): Promise< RemoteDevice[] > {
	const state = await readRemoteAccess();
	return state.devices.filter( ( entry ) => entry.expiresAt > now ).map( toRemoteDevice );
}

export function revokeRemoteDevice( deviceId: string ): Promise< boolean > {
	return updateRemoteAccess( ( state ) => {
		const before = state.devices.length;
		state.devices = state.devices.filter( ( entry ) => entry.id !== deviceId );
		return state.devices.length < before;
	} );
}

// `studio remote pair` runs in another process and needs the running server's address.
export async function setRemoteServerInfo(
	info: { url: string; pid: number; connection: RemoteConnectionKind; fallbackReason?: string },
	now = Date.now()
): Promise< void > {
	await updateRemoteAccess( ( state ) => {
		state.server = { ...info, startedAt: now };
	} );
}

// Writes this process's record unless a live `studio remote` other than this
// one holds it, in one locked update: of two that start at once, one gets the
// record and the other stops before it shows a code. Returns the holder's record.
export async function claimRemoteServerInfo(
	info: { url: string; pid: number; connection: RemoteConnectionKind; fallbackReason?: string },
	isAlive: ( pid: number ) => boolean,
	now = Date.now()
): Promise< RemoteServerInfo | undefined > {
	return updateRemoteAccess( ( state ) => {
		const holder = state.server;
		if ( holder && holder.pid !== info.pid && isAlive( holder.pid ) ) {
			return holder;
		}
		state.server = { ...info, startedAt: now };
		return undefined;
	} );
}

export async function clearRemoteServerInfo( pid: number ): Promise< void > {
	await updateRemoteAccess( ( state ) => {
		if ( state.server?.pid === pid ) {
			delete state.server;
		}
	} );
}

export async function readRemoteServerInfo(): Promise< RemoteServerInfo | undefined > {
	return ( await readRemoteAccess() ).server;
}

// What the QR code holds. The phone app registers the `studio-remote` scheme.
export function buildPairingUrl( input: {
	url: string;
	code: string;
	instanceId: string;
} ): string {
	const params = new URLSearchParams( {
		url: input.url,
		code: input.code,
		id: input.instanceId,
	} );
	return `studio-remote://pair?${ params.toString() }`;
}
