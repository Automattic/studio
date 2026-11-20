import { createHash } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	authenticateDeviceToken,
	buildPairingUrl,
	claimRemoteServerInfo,
	clearPairingCodes,
	clearRemoteServerInfo,
	createPairingCode,
	DEVICE_TOKEN_TTL_MS,
	formatPairingCode,
	getRemoteInstanceId,
	listRemoteDevices,
	PAIRING_CODE_TTL_MS,
	PAIRING_MAX_FAILED_ATTEMPTS,
	readRemoteAccess,
	readRemoteServerInfo,
	RemoteAccessVersionMismatchError,
	redeemPairingCode,
	revokePairingCode,
	revokeRemoteDevice,
	setRemoteServerInfo,
	updateRemoteAccess,
} from '../remote-access';

let configDir: string;
const storePath = () => path.join( configDir, 'remote.json' );
const readStore = () => JSON.parse( readFileSync( storePath(), 'utf8' ) );
const sha256 = ( value: string ) => createHash( 'sha256' ).update( value ).digest( 'hex' );

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-access-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

describe( 'remote access store', () => {
	it( 'starts empty when there is no file', async () => {
		const state = await readRemoteAccess();
		expect( state.devices ).toEqual( [] );
		expect( state.pairingCodes ).toEqual( [] );
		expect( existsSync( storePath() ) ).toBe( false );
	} );

	it( 'keeps one instance id across calls', async () => {
		const first = await getRemoteInstanceId();
		const second = await getRemoteInstanceId();
		expect( first ).toMatch( /^[0-9a-f-]{36}$/ );
		expect( second ).toBe( first );
	} );

	it( 'persists what a mutation changes and returns its result', async () => {
		const result = await updateRemoteAccess( ( state ) => {
			state.server = { url: 'http://192.168.1.20:8082', pid: 123, startedAt: 1 };
			return 'done';
		} );
		expect( result ).toBe( 'done' );
		expect( JSON.parse( readFileSync( storePath(), 'utf8' ) ).server.pid ).toBe( 123 );
	} );

	it( 'treats a corrupt file as empty, which unpairs every device', async () => {
		writeFileSync( storePath(), '{ not json' );
		expect( ( await readRemoteAccess() ).devices ).toEqual( [] );
	} );

	it( 'throws when a newer build wrote the file', async () => {
		writeFileSync(
			storePath(),
			JSON.stringify( { version: 2, instanceId: 'x', pairingCodes: [], devices: [] } )
		);
		await expect( readRemoteAccess() ).rejects.toBeInstanceOf( RemoteAccessVersionMismatchError );
	} );

	it( 'leaves a newer build file alone when updating', async () => {
		const original = JSON.stringify( {
			version: 2,
			instanceId: 'x',
			pairingCodes: [],
			devices: [],
		} );
		writeFileSync( storePath(), original );
		await expect( updateRemoteAccess( () => undefined ) ).rejects.toBeInstanceOf(
			RemoteAccessVersionMismatchError
		);
		expect( readFileSync( storePath(), 'utf8' ) ).toBe( original );
	} );

	it( 'keeps fields a newer build added', async () => {
		writeFileSync(
			storePath(),
			JSON.stringify( {
				version: 1,
				instanceId: 'x',
				pairingCodes: [
					{
						codeHash: 'code-hash',
						expiresAt: Date.now() + 60_000,
						failedAttempts: 0,
						futureCodeField: 'c',
					},
				],
				server: { url: 'http://x', pid: 1, startedAt: 1, futureServerField: 's' },
				futureField: 1,
				devices: [
					{
						id: 'd1',
						name: 'Phone',
						platform: 'ios',
						tokenHash: 'hash',
						pairedAt: 1,
						lastSeenAt: 2,
						expiresAt: 3,
						futureDeviceField: true,
					},
				],
			} )
		);
		await updateRemoteAccess( () => undefined );
		const saved = JSON.parse( readFileSync( storePath(), 'utf8' ) );
		expect( saved.futureField ).toBe( 1 );
		expect( saved.devices[ 0 ].futureDeviceField ).toBe( true );
		expect( saved.pairingCodes[ 0 ].futureCodeField ).toBe( 'c' );
		expect( saved.server.futureServerField ).toBe( 's' );
	} );

	it( 'rethrows I/O errors instead of reading them as empty', async () => {
		mkdirSync( storePath() );
		await expect( readRemoteAccess() ).rejects.toMatchObject( { code: 'EISDIR' } );
		await expect( updateRemoteAccess( () => undefined ) ).rejects.toMatchObject( {
			code: 'EISDIR',
		} );
	} );

	it( 'reads valid JSON with the wrong shape as empty', async () => {
		writeFileSync( storePath(), JSON.stringify( { version: 1 } ) );
		expect( ( await readRemoteAccess() ).devices ).toEqual( [] );
	} );

	it.skipIf( process.platform === 'win32' )( 'writes the file with mode 0600', async () => {
		await updateRemoteAccess( () => undefined );
		expect( statSync( storePath() ).mode & 0o777 ).toBe( 0o600 );
	} );

	it( 'serialises concurrent updates', async () => {
		await updateRemoteAccess( ( state ) => {
			state.server = { url: 'http://x', pid: 1, startedAt: 0 };
		} );
		await Promise.all(
			Array.from( { length: 10 }, () =>
				updateRemoteAccess( ( state ) => {
					if ( state.server ) {
						state.server.startedAt += 1;
					}
				} )
			)
		);
		expect( ( await readRemoteAccess() ).server?.startedAt ).toBe( 10 );
	} );

	it( 'writes nothing and releases the lock when a mutation throws', async () => {
		await updateRemoteAccess( () => undefined );
		const before = readFileSync( storePath(), 'utf8' );
		await expect(
			updateRemoteAccess( () => {
				throw new Error( 'boom' );
			} )
		).rejects.toThrow( 'boom' );
		expect( existsSync( path.join( configDir, 'remote.json.lock' ) ) ).toBe( false );
		expect( readFileSync( storePath(), 'utf8' ) ).toBe( before );
		await expect( updateRemoteAccess( () => 'ok' ) ).resolves.toBe( 'ok' );
	} );

	it( 'does not write an invalid state', async () => {
		await updateRemoteAccess( () => undefined );
		const before = readFileSync( storePath(), 'utf8' );
		await expect(
			updateRemoteAccess( ( state ) => {
				state.devices.push( {
					id: 'd1',
					name: 'Phone',
					platform: 'ios',
					tokenHash: 'hash',
					pairedAt: 1,
					lastSeenAt: 2,
					expiresAt: NaN,
				} );
			} )
		).rejects.toThrow();
		expect( readFileSync( storePath(), 'utf8' ) ).toBe( before );
	} );

	it( 'does not rewrite the file when reading the instance id', async () => {
		const first = await getRemoteInstanceId();
		const content = readFileSync( storePath(), 'utf8' );
		const { mtimeMs, ino } = statSync( storePath() );
		const second = await getRemoteInstanceId();
		expect( second ).toBe( first );
		expect( readFileSync( storePath(), 'utf8' ) ).toBe( content );
		expect( statSync( storePath() ).mtimeMs ).toBe( mtimeMs );
		expect( statSync( storePath() ).ino ).toBe( ino );
	} );
} );

const phone = { deviceName: "Sam's iPhone", platform: 'ios' as const };

describe( 'pairing codes', () => {
	it( 'mints a 12-character code from the unambiguous alphabet', async () => {
		const { code, expiresAt } = await createPairingCode( 1_000 );
		expect( code ).toMatch( /^[0-9A-HJKMNP-TV-Z]{12}$/ );
		expect( expiresAt ).toBe( 1_000 + PAIRING_CODE_TTL_MS );
	} );

	it( 'drops every open code and keeps the paired devices', async () => {
		const paired = await createPairingCode();
		await redeemPairingCode( { code: paired.code, ...phone } );
		const first = await createPairingCode();
		const second = await createPairingCode();

		await clearPairingCodes();

		expect( await redeemPairingCode( { code: first.code, ...phone } ) ).toBeNull();
		expect( await redeemPairingCode( { code: second.code, ...phone } ) ).toBeNull();
		expect( readStore().pairingCodes ).toEqual( [] );
		expect( await listRemoteDevices() ).toHaveLength( 1 );
	} );

	it( 'revokes one code and keeps the others', async () => {
		const first = await createPairingCode();
		const second = await createPairingCode();

		await revokePairingCode( formatPairingCode( first.code ) );

		expect( await redeemPairingCode( { code: first.code, ...phone } ) ).toBeNull();
		expect( await redeemPairingCode( { code: second.code, ...phone } ) ).not.toBeNull();
	} );

	it( 'never stores the code itself', async () => {
		const { code } = await createPairingCode();
		expect( readFileSync( storePath(), 'utf8' ) ).not.toContain( code );
	} );

	it( 'redeems a code once and returns a device token', async () => {
		const { code } = await createPairingCode( 1_000 );
		const paired = await redeemPairingCode( { code, ...phone }, 2_000 );
		expect( paired?.token ).toMatch( /^[A-Za-z0-9_-]{43}$/ );
		expect( paired?.deviceId ).toMatch( /^[0-9a-f-]{36}$/ );
		expect( await redeemPairingCode( { code, ...phone }, 3_000 ) ).toBeNull();
	} );

	it( 'accepts the code as people type it: lower case, with dashes and spaces', async () => {
		const { code } = await createPairingCode();
		const typed = formatPairingCode( code ).toLowerCase().replace( '-', ' - ' );
		expect( await redeemPairingCode( { code: typed, ...phone } ) ).not.toBeNull();
	} );

	it( 'rejects an expired code', async () => {
		const { code } = await createPairingCode( 1_000 );
		const late = 1_000 + PAIRING_CODE_TTL_MS;
		expect( await redeemPairingCode( { code, ...phone }, late ) ).toBeNull();
	} );

	it( 'invalidates the code after too many wrong attempts', async () => {
		const { code } = await createPairingCode();
		for ( let attempt = 0; attempt < PAIRING_MAX_FAILED_ATTEMPTS; attempt += 1 ) {
			expect( await redeemPairingCode( { code: 'WRONGWRONGWR', ...phone } ) ).toBeNull();
		}
		expect( await redeemPairingCode( { code, ...phone } ) ).toBeNull();
	} );

	it( 'does not lock or write when no code is open', async () => {
		await getRemoteInstanceId();
		const content = readFileSync( storePath(), 'utf8' );
		const { mtimeMs, ino } = statSync( storePath() );
		expect( await redeemPairingCode( { code: 'WRONGWRONGWR', ...phone } ) ).toBeNull();
		expect( readFileSync( storePath(), 'utf8' ) ).toBe( content );
		expect( statSync( storePath() ).mtimeMs ).toBe( mtimeMs );
		expect( statSync( storePath() ).ino ).toBe( ino );
	} );

	it( 'accepts look-alike characters: o for 0, i and l for 1', async () => {
		let code = '';
		for ( let attempt = 0; attempt < 50 && ! /[01]/.test( code ); attempt += 1 ) {
			code = ( await createPairingCode() ).code;
		}
		expect( code ).toMatch( /[01]/ );
		const typed = code.replace( /0/g, 'o' ).replace( /1/g, 'l' );
		expect( await redeemPairingCode( { code: typed, ...phone } ) ).not.toBeNull();
	} );

	it( 'allows exactly the attempt limit of wrong guesses', async () => {
		const { code } = await createPairingCode();
		for ( let attempt = 0; attempt < PAIRING_MAX_FAILED_ATTEMPTS - 1; attempt += 1 ) {
			expect( await redeemPairingCode( { code: 'WRONGWRONGWR', ...phone } ) ).toBeNull();
		}
		expect( await redeemPairingCode( { code, ...phone } ) ).not.toBeNull();
	} );

	it( 'counts a wrong attempt against every open code', async () => {
		const first = await createPairingCode();
		const second = await createPairingCode();
		for ( let attempt = 0; attempt < PAIRING_MAX_FAILED_ATTEMPTS; attempt += 1 ) {
			await redeemPairingCode( { code: 'WRONGWRONGWR', ...phone } );
		}
		expect( await redeemPairingCode( { code: first.code, ...phone } ) ).toBeNull();
		expect( await redeemPairingCode( { code: second.code, ...phone } ) ).toBeNull();
	} );

	it( 'keeps several codes open at once', async () => {
		const first = await createPairingCode();
		await createPairingCode();
		expect( await redeemPairingCode( { code: first.code, ...phone } ) ).not.toBeNull();
	} );

	it( 'redeems a code once when two requests race', async () => {
		const { code } = await createPairingCode();
		const results = await Promise.all( [
			redeemPairingCode( { code, ...phone } ),
			redeemPairingCode( { code, ...phone } ),
		] );
		expect( results.filter( ( result ) => result !== null ) ).toHaveLength( 1 );
		expect( await listRemoteDevices() ).toHaveLength( 1 );
	} );

	it( 'stores only the hash of a code', async () => {
		const { code } = await createPairingCode();
		const [ entry ] = readStore().pairingCodes;
		expect( Object.keys( entry ).sort() ).toEqual( [ 'codeHash', 'expiresAt', 'failedAttempts' ] );
		expect( entry.codeHash ).toBe( sha256( code ) );
	} );

	it( 'formats a code in groups of four', () => {
		expect( formatPairingCode( 'ABCDEFGH2345' ) ).toBe( 'ABCD-EFGH-2345' );
	} );
} );

describe( 'device tokens', () => {
	async function pair( now = 1_000 ) {
		const { code } = await createPairingCode( now );
		const paired = await redeemPairingCode( { code, ...phone }, now );
		if ( ! paired ) {
			throw new Error( 'pairing failed' );
		}
		return paired;
	}

	it( 'authenticates the token it issued and no other', async () => {
		const { token, deviceId } = await pair();
		expect( ( await authenticateDeviceToken( token, 2_000 ) )?.id ).toBe( deviceId );
		expect( await authenticateDeviceToken( 'not-the-token', 2_000 ) ).toBeNull();
		expect( await authenticateDeviceToken( '', 2_000 ) ).toBeNull();
	} );

	it( 'never stores the token itself', async () => {
		const { token } = await pair();
		expect( readFileSync( storePath(), 'utf8' ) ).not.toContain( token );
	} );

	it( 'rejects a token after 30 days', async () => {
		const { token } = await pair( 1_000 );
		expect( await authenticateDeviceToken( token, 1_000 + DEVICE_TOKEN_TTL_MS ) ).toBeNull();
	} );

	it( 'records when the device was last seen', async () => {
		const { token } = await pair( 1_000 );
		await authenticateDeviceToken( token, 1_000 + 5 * 60 * 1000 );
		const [ device ] = await listRemoteDevices( 1_000 + 5 * 60 * 1000 );
		expect( device.lastSeenAt ).toBe( 1_000 + 5 * 60 * 1000 );
	} );

	it( 'strips control characters from the device name', async () => {
		const { code } = await createPairingCode();
		await redeemPairingCode( {
			code,
			deviceName: '\u001b[31mRed\u001b[0m phone\n',
			platform: 'ios',
		} );
		const [ device ] = await listRemoteDevices();
		expect( device.name ).toBe( '[31mRed[0m phone' );
	} );

	it( 'strips format characters such as a right-to-left override from the device name', async () => {
		const { code } = await createPairingCode();
		await redeemPairingCode( {
			code,
			deviceName: 'Phone\u202E3gp.exe\u200B',
			platform: 'ios',
		} );
		const [ device ] = await listRemoteDevices();
		expect( device.name ).toBe( 'Phone3gp.exe' );
	} );

	it( 'stores only the hash of a token', async () => {
		const { token } = await pair();
		const [ device ] = readStore().devices;
		expect( Object.keys( device ).sort() ).toEqual( [
			'expiresAt',
			'id',
			'lastSeenAt',
			'name',
			'pairedAt',
			'platform',
			'tokenHash',
		] );
		expect( device.tokenHash ).toBe( sha256( token ) );
	} );

	it( 'is valid for 30 days', async () => {
		const { token, expiresAt } = await pair( 1_000 );
		expect( expiresAt ).toBe( 1_000 + DEVICE_TOKEN_TTL_MS );
		expect( await authenticateDeviceToken( token, expiresAt - 1 ) ).not.toBeNull();
	} );

	it( 'revokes only the device it names', async () => {
		const first = await pair();
		const second = await pair();
		await revokeRemoteDevice( first.deviceId );
		expect( await authenticateDeviceToken( first.token, 2_000 ) ).toBeNull();
		expect( ( await authenticateDeviceToken( second.token, 2_000 ) )?.id ).toBe( second.deviceId );
	} );

	it( 'leaves an expired device out of the list', async () => {
		const { expiresAt } = await pair( 1_000 );
		expect( await listRemoteDevices( expiresAt - 1 ) ).toHaveLength( 1 );
		expect( await listRemoteDevices( expiresAt ) ).toEqual( [] );
	} );

	it( 'cuts a long device name to 80 characters', async () => {
		const { code } = await createPairingCode();
		await redeemPairingCode( { code, deviceName: 'x'.repeat( 100 ), platform: 'ios' } );
		const [ device ] = await listRemoteDevices();
		expect( device.name ).toBe( 'x'.repeat( 80 ) );
	} );

	it( 'lists devices without their token hash', async () => {
		await pair();
		const [ device ] = await listRemoteDevices( 2_000 );
		expect( device ).toMatchObject( { name: "Sam's iPhone", platform: 'ios' } );
		expect( device ).not.toHaveProperty( 'tokenHash' );
	} );

	it( 'revokes a device at once', async () => {
		const { token, deviceId } = await pair();
		expect( await revokeRemoteDevice( deviceId ) ).toBe( true );
		expect( await authenticateDeviceToken( token, 2_000 ) ).toBeNull();
		expect( await revokeRemoteDevice( deviceId ) ).toBe( false );
	} );

	it( 'answers many parallel requests after an idle minute with a single write', async () => {
		const { token } = await pair( 1_000 );
		const later = 1_000 + 5 * 60 * 1000;
		const results = await Promise.all(
			Array.from( { length: 20 }, () => authenticateDeviceToken( token, later ) )
		);
		expect( results.every( ( device ) => device !== null ) ).toBe( true );
		const { mtimeMs, ino } = statSync( storePath() );
		expect( await authenticateDeviceToken( token, later ) ).not.toBeNull();
		expect( statSync( storePath() ).mtimeMs ).toBe( mtimeMs );
		expect( statSync( storePath() ).ino ).toBe( ino );
	} );

	it( 'writes the last-seen time at most once a minute', async () => {
		const { token } = await pair( 1_000 );
		const content = readFileSync( storePath(), 'utf8' );
		await authenticateDeviceToken( token, 1_000 + 30_000 );
		expect( readFileSync( storePath(), 'utf8' ) ).toBe( content );
	} );

	it( 'rejects a device revoked before its last-seen write and does not bring it back', async () => {
		const { token, deviceId } = await pair( 1_000 );
		await revokeRemoteDevice( deviceId );
		expect( await authenticateDeviceToken( token, 1_000 + 5 * 60 * 1000 ) ).toBeNull();
		expect( await listRemoteDevices( 1_000 + 5 * 60 * 1000 ) ).toEqual( [] );
	} );

	it.skipIf( process.platform === 'win32' || process.getuid?.() === 0 )(
		'does not fail a valid token when the last-seen write fails',
		async () => {
			const { token, deviceId } = await pair( 1_000 );
			chmodSync( configDir, 0o500 );
			try {
				const device = await authenticateDeviceToken( token, 1_000 + 5 * 60 * 1000 );
				expect( device?.id ).toBe( deviceId );
			} finally {
				chmodSync( configDir, 0o700 );
			}
		}
	);
} );

describe( 'running server record', () => {
	it( 'remembers where the remote server listens, and over which connection', async () => {
		await setRemoteServerInfo(
			{ url: 'https://my-mac.tail1234.ts.net:8082', pid: 4242, connection: 'https' },
			9_000
		);
		expect( await readRemoteServerInfo() ).toEqual( {
			url: 'https://my-mac.tail1234.ts.net:8082',
			pid: 4242,
			startedAt: 9_000,
			connection: 'https',
		} );
	} );

	it( 'reads a record from a build before the connection options', async () => {
		await updateRemoteAccess( ( state ) => {
			state.server = { url: 'http://192.168.1.20:8082', pid: 4242, startedAt: 9_000 };
		} );
		expect( await readRemoteServerInfo() ).toEqual( {
			url: 'http://192.168.1.20:8082',
			pid: 4242,
			startedAt: 9_000,
		} );
	} );

	it( 'only the process that wrote the record clears it', async () => {
		await setRemoteServerInfo( {
			url: 'http://192.168.1.20:8082',
			pid: 4242,
			connection: 'local',
		} );
		await clearRemoteServerInfo( 1 );
		expect( await readRemoteServerInfo() ).toBeDefined();
		await clearRemoteServerInfo( 4242 );
		expect( await readRemoteServerInfo() ).toBeUndefined();
	} );

	it( "takes the record when no live server holds it, also over a stopped one's", async () => {
		await setRemoteServerInfo( {
			url: 'http://192.168.1.20:8082',
			pid: 4242,
			connection: 'local',
		} );

		const holder = await claimRemoteServerInfo(
			{ url: 'http://100.101.102.103:8084', pid: 5151, connection: 'tailnet' },
			() => false,
			9_000
		);

		expect( holder ).toBeUndefined();
		expect( await readRemoteServerInfo() ).toEqual( {
			url: 'http://100.101.102.103:8084',
			pid: 5151,
			startedAt: 9_000,
			connection: 'tailnet',
		} );
	} );

	it( 'leaves the record to a live server that holds it, and names it', async () => {
		await setRemoteServerInfo( {
			url: 'http://192.168.1.20:8082',
			pid: 4242,
			connection: 'local',
		} );

		const holder = await claimRemoteServerInfo(
			{ url: 'http://100.101.102.103:8084', pid: 5151, connection: 'tailnet' },
			() => true
		);

		expect( holder ).toMatchObject( { url: 'http://192.168.1.20:8082', pid: 4242 } );
		expect( await readRemoteServerInfo() ).toMatchObject( { pid: 4242 } );
	} );

	it( 'gives the record to one of two servers that claim it at once', async () => {
		const claim = ( pid: number ) =>
			claimRemoteServerInfo(
				{ url: `http://127.0.0.1:${ pid }`, pid, connection: 'local' },
				( other ) => other === 1001 || other === 1002
			);

		const results = await Promise.all( [ claim( 1001 ), claim( 1002 ) ] );

		expect( results.filter( ( holder ) => holder === undefined ) ).toHaveLength( 1 );
		const winner = results[ 0 ] === undefined ? 1001 : 1002;
		expect( await readRemoteServerInfo() ).toMatchObject( { pid: winner } );
	} );
} );

describe( 'buildPairingUrl', () => {
	it( 'carries the address, the code and the instance id', () => {
		const url = new URL(
			buildPairingUrl( {
				url: 'http://192.168.1.20:8082',
				code: 'ABCDEFGH2345',
				instanceId: 'instance-1',
			} )
		);
		expect( url.protocol ).toBe( 'studio-remote:' );
		expect( url.host ).toBe( 'pair' );
		expect( url.searchParams.get( 'url' ) ).toBe( 'http://192.168.1.20:8082' );
		expect( url.searchParams.get( 'code' ) ).toBe( 'ABCDEFGH2345' );
		expect( url.searchParams.get( 'id' ) ).toBe( 'instance-1' );
	} );
} );
