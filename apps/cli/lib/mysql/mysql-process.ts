import fs from 'fs';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'os';
import path from 'path';
import { ensureMysqlBinaryAvailable } from 'cli/lib/dependency-management/mysql-binary';
import {
	getMysqlAdminBinaryPath,
	getMysqlClientBinaryPath,
	getMysqlServerBinaryPath,
} from 'cli/lib/dependency-management/paths';
import type { MysqlSiteConfig } from '@studio/common/lib/database-engine';

const MYSQL_START_TIMEOUT_MS = 60_000;
const MYSQL_STOP_TIMEOUT_MS = 10_000;
const MYSQL_COMMAND_TIMEOUT_MS = 30_000;
// Importing a full-site dump can take much longer than a normal command.
const MYSQL_IMPORT_TIMEOUT_MS = 20 * 60_000;
const MYSQL_POLL_INTERVAL_MS = 250;
const MYSQL_DOWNLOAD_PROGRESS_INTERVAL_BYTES = 5 * 1024 * 1024;

type Logger = ( ...args: Parameters< typeof console.log > ) => void;

export type ManagedMysqlServer = {
	started: boolean;
	stop: () => Promise< void >;
};

const runningServers = new Map< string, ChildProcess >();

export async function ensureMysqlServerRunning(
	config: MysqlSiteConfig,
	logToConsole?: Logger,
	signal?: AbortSignal
): Promise< ManagedMysqlServer > {
	if ( await canConnectToMysql( config ) ) {
		return noopServer();
	}

	const existing = runningServers.get( config.dataDir );
	if ( existing && existing.exitCode === null && existing.signalCode === null ) {
		await waitForMysqlReady( config, existing, signal );
		return {
			started: true,
			stop: () => stopMysqlChild( config, existing ),
		};
	}

	let lastLoggedDownload = 0;
	let loggedComplete = false;
	const version = await ensureMysqlBinaryAvailable( undefined, ( downloaded, total ) => {
		const isComplete = total > 0 && downloaded >= total;
		if (
			downloaded - lastLoggedDownload < MYSQL_DOWNLOAD_PROGRESS_INTERVAL_BYTES &&
			! ( isComplete && ! loggedComplete )
		) {
			return;
		}

		lastLoggedDownload = downloaded;
		loggedComplete ||= isComplete;
		const dl = ( downloaded / 1024 / 1024 ).toFixed( 1 );
		const tot = total ? ` / ${ ( total / 1024 / 1024 ).toFixed( 1 ) } MB` : '';
		logToConsole?.( `Downloading MySQL ${ dl } MB${ tot }` );
	} );
	if ( config.serverVersion !== version ) {
		throw new Error(
			`MySQL site expects server ${ config.serverVersion }, but Studio installed ${ version }.`
		);
	}

	await initializeDataDir( config, signal );

	const runtimeDir = getRuntimeDir( config );
	fs.mkdirSync( runtimeDir, { recursive: true } );

	const mysqld = spawn(
		getMysqlServerBinaryPath( config.serverVersion ),
		[
			'--no-defaults',
			`--basedir=${ getMysqlInstallRootFromVersion( config.serverVersion ) }`,
			`--datadir=${ config.dataDir }`,
			`--port=${ config.port }`,
			`--bind-address=${ config.host }`,
			`--socket=${ path.join( runtimeDir, 'mysql.sock' ) }`,
			`--pid-file=${ path.join( runtimeDir, 'mysql.pid' ) }`,
			'--mysqlx=0',
			// Pin the server clock to UTC. WordPress and Action Scheduler store all
			// `*_date_gmt` / `*_gmt` columns as PHP-computed UTC (gmdate), so the
			// database's own clock must be UTC too. Left at the default `SYSTEM`
			// zone, `NOW()`/`CURRENT_TIMESTAMP` return the host's local time (e.g.
			// EDT, UTC-4) while the stored values are UTC — a multi-hour disagreement
			// that makes UTC timestamps look future-dated to any query comparing them
			// against the DB clock and corrupts any WP/plugin logic mixing MySQL
			// `NOW()` with a `_gmt` column.
			'--default-time-zone=+00:00',
		],
		{
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			signal,
		}
	);

	let stderr = '';
	mysqld.stdout?.on( 'data', ( chunk ) => {
		logToConsole?.( `[MySQL] ${ chunk.toString().trimEnd() }` );
	} );
	mysqld.stderr?.on( 'data', ( chunk ) => {
		const text = chunk.toString();
		stderr += text;
		logToConsole?.( `[MySQL] ${ text.trimEnd() }` );
	} );
	mysqld.once( 'exit', () => {
		if ( runningServers.get( config.dataDir ) === mysqld ) {
			runningServers.delete( config.dataDir );
		}
	} );

	runningServers.set( config.dataDir, mysqld );

	try {
		await waitForMysqlReady( config, mysqld, signal );
	} catch ( error ) {
		await stopMysqlChild( config, mysqld ).catch( () => undefined );
		throw new Error(
			`MySQL server failed to start: ${ error instanceof Error ? error.message : String( error ) }${
				stderr.trim() ? `\n${ stderr.trim() }` : ''
			}`
		);
	}

	return {
		started: true,
		stop: () => stopMysqlChild( config, mysqld ),
	};
}

export async function runMysqlQuery(
	config: MysqlSiteConfig,
	sql: string,
	options: { user?: string; password?: string; database?: string } = {}
): Promise< string > {
	const args = [
		'--batch',
		'--skip-column-names',
		'--protocol=tcp',
		`--host=${ config.host }`,
		`--port=${ config.port }`,
		`--user=${ options.user ?? 'root' }`,
		...( options.password !== undefined ? [ `--password=${ options.password }` ] : [] ),
		...( options.database ? [ options.database ] : [] ),
		'--execute',
		sql,
	];
	const result = await runMysqlCommand( getMysqlClientBinaryPath( config.serverVersion ), args );
	return result.stdout;
}

// WordPress data legitimately carries `datetime DEFAULT '0000-00-00 00:00:00'`
// columns, which MySQL 8's default strict SQL mode (NO_ZERO_DATE / NO_ZERO_IN_DATE
// / STRICT_TRANS_TABLES) rejects at CREATE TABLE time. WordPress core itself runs
// against MySQL with a permissive sql_mode for exactly this reason, so the import
// session must relax those modes to load a genuine WordPress dump. This is the
// same accommodation `wp db import` / mysqldump round-trips rely on — not a
// workaround for a bad dump, but how WordPress data lives in MySQL.
const MYSQL_IMPORT_SQL_MODE = 'NO_ENGINE_SUBSTITUTION';

/**
 * Loads a `.sql` file into a MySQL database by streaming the file on the client's
 * stdin. The dump is typically hundreds of MB, so it must be piped rather than
 * passed via `--execute`. Runs against the provisioned per-site database.
 */
export async function importSqlFileIntoMysql(
	config: MysqlSiteConfig,
	sqlFilePath: string,
	options: { user?: string; password?: string; database?: string; timeoutMs?: number } = {}
): Promise< void > {
	if ( ! fs.existsSync( sqlFilePath ) ) {
		throw new Error( `SQL file not found for MySQL import: ${ sqlFilePath }` );
	}

	const database = options.database ?? config.databaseName;
	const args = [
		'--protocol=tcp',
		`--host=${ config.host }`,
		`--port=${ config.port }`,
		`--user=${ options.user ?? 'root' }`,
		...( options.password !== undefined ? [ `--password=${ options.password }` ] : [] ),
		`--init-command=SET SESSION sql_mode='${ MYSQL_IMPORT_SQL_MODE }'`,
		database,
	];

	await runMysqlCommand( getMysqlClientBinaryPath( config.serverVersion ), args, {
		stdinFile: sqlFilePath,
		timeoutMs: options.timeoutMs ?? MYSQL_IMPORT_TIMEOUT_MS,
	} );
}

export async function canConnectToMysql( config: MysqlSiteConfig ): Promise< boolean > {
	const result = await runMysqlCommand(
		getMysqlAdminBinaryPath( config.serverVersion ),
		[
			'--protocol=tcp',
			`--host=${ config.host }`,
			`--port=${ config.port }`,
			'--user=root',
			'ping',
		],
		{ rejectOnExitCode: false, timeoutMs: 2_000 }
	).catch( () => undefined );
	return result?.code === 0;
}

async function initializeDataDir( config: MysqlSiteConfig, signal?: AbortSignal ): Promise< void > {
	if ( fs.existsSync( path.join( config.dataDir, 'mysql' ) ) ) {
		return;
	}

	fs.mkdirSync( config.dataDir, { recursive: true } );
	await runMysqlCommand(
		getMysqlServerBinaryPath( config.serverVersion ),
		[
			'--no-defaults',
			'--initialize-insecure',
			`--basedir=${ getMysqlInstallRootFromVersion( config.serverVersion ) }`,
			`--datadir=${ config.dataDir }`,
		],
		{ signal, timeoutMs: MYSQL_START_TIMEOUT_MS }
	);
}

async function waitForMysqlReady(
	config: MysqlSiteConfig,
	child: ChildProcess,
	signal?: AbortSignal
): Promise< void > {
	const deadline = Date.now() + MYSQL_START_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		signal?.throwIfAborted();
		if ( child.exitCode !== null || child.signalCode !== null ) {
			throw new Error( `mysqld exited before becoming ready` );
		}
		if ( await canConnectToMysql( config ) ) {
			return;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, MYSQL_POLL_INTERVAL_MS ) );
	}
	throw new Error( `Timed out waiting for mysqld on ${ config.host }:${ config.port }` );
}

async function stopMysqlChild( config: MysqlSiteConfig, child: ChildProcess ): Promise< void > {
	if ( child.exitCode !== null || child.signalCode !== null ) {
		runningServers.delete( config.dataDir );
		return;
	}

	await runMysqlCommand(
		getMysqlAdminBinaryPath( config.serverVersion ),
		[
			'--protocol=tcp',
			`--host=${ config.host }`,
			`--port=${ config.port }`,
			'--user=root',
			'shutdown',
		],
		{ rejectOnExitCode: false, timeoutMs: MYSQL_STOP_TIMEOUT_MS }
	).catch( () => undefined );

	await waitForExitOrKill( child, MYSQL_STOP_TIMEOUT_MS );
	runningServers.delete( config.dataDir );
}

async function waitForExitOrKill( child: ChildProcess, timeoutMs: number ): Promise< void > {
	if ( child.exitCode !== null || child.signalCode !== null ) {
		return;
	}

	await new Promise< void >( ( resolve ) => {
		const timeout = setTimeout( () => {
			child.kill( 'SIGKILL' );
			resolve();
		}, timeoutMs );
		child.once( 'exit', () => {
			clearTimeout( timeout );
			resolve();
		} );
	} );
}

async function runMysqlCommand(
	command: string,
	args: string[],
	options: {
		rejectOnExitCode?: boolean;
		signal?: AbortSignal;
		timeoutMs?: number;
		stdinFile?: string;
	} = {}
): Promise< { stdout: string; stderr: string; code: number } > {
	const {
		rejectOnExitCode = true,
		signal,
		timeoutMs = MYSQL_COMMAND_TIMEOUT_MS,
		stdinFile,
	} = options;

	return await new Promise< { stdout: string; stderr: string; code: number } >(
		( resolve, reject ) => {
			const child = spawn( command, args, {
				stdio: [ stdinFile ? 'pipe' : 'ignore', 'pipe', 'pipe' ],
				signal,
			} );
			let stdout = '';
			let stderr = '';
			let settled = false;
			const timeout = setTimeout( () => {
				if ( settled ) {
					return;
				}
				settled = true;
				child.kill( 'SIGKILL' );
				reject( new Error( `MySQL command timed out: ${ command }` ) );
			}, timeoutMs );

			if ( stdinFile && child.stdin ) {
				const readStream = fs.createReadStream( stdinFile );
				readStream.on( 'error', ( error ) => {
					if ( settled ) {
						return;
					}
					settled = true;
					clearTimeout( timeout );
					if ( ! child.killed ) {
						child.kill( 'SIGKILL' );
					}
					reject( error );
				} );
				readStream.pipe( child.stdin );
			}

			child.stdout?.on( 'data', ( chunk ) => {
				stdout += chunk.toString();
			} );
			child.stderr?.on( 'data', ( chunk ) => {
				stderr += chunk.toString();
			} );
			child.once( 'error', ( error ) => {
				if ( settled ) {
					return;
				}
				settled = true;
				clearTimeout( timeout );
				reject( error );
			} );
			child.once( 'close', ( code ) => {
				if ( settled ) {
					return;
				}
				settled = true;
				clearTimeout( timeout );
				const exitCode = code ?? 1;
				if ( rejectOnExitCode && exitCode !== 0 ) {
					reject(
						new Error(
							`MySQL command failed (code: ${ exitCode }): ${
								stderr.trim() || stdout.trim() || command
							}`
						)
					);
					return;
				}
				resolve( { stdout, stderr, code: exitCode } );
			} );
		}
	);
}

function noopServer(): ManagedMysqlServer {
	return {
		started: false,
		stop: async () => undefined,
	};
}

function getRuntimeDir( config: MysqlSiteConfig ): string {
	const safeName = path.basename( config.dataDir ).replace( /[^a-zA-Z0-9_.-]/g, '-' );
	const shortName = safeName.slice( 0, 8 );
	const tmpDir = process.platform === 'win32' ? os.tmpdir() : '/tmp';
	return path.join( tmpDir, `studio-mysql-${ shortName }-${ config.port }` );
}

function getMysqlInstallRootFromVersion( version: string ): string {
	return path.dirname( path.dirname( getMysqlServerBinaryPath( version ) ) );
}
