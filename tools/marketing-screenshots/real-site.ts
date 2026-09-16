import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CLI_PATH = path.resolve( import.meta.dirname, '../../apps/cli/dist/cli/main.mjs' );
const SITE_NAME = 'Meridian Coffee';
const ADMIN_USERNAME = 'studio';
const ADMIN_PASSWORD = 'studio-marketing-only';
const ADMIN_EMAIL = 'studio-marketing@example.test';
const DEFAULT_TIMEOUT_MS = 240_000;

interface CliEnvironment {
	root: string;
	configDirectory: string;
	daemonDirectory: string;
	siteDirectory: string;
	variables: NodeJS.ProcessEnv;
}

interface CliResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export interface RealWordPressSite {
	origin: string;
	close: () => Promise< void >;
}

export async function createRealWordPressSite(
	timeoutMs = DEFAULT_TIMEOUT_MS
): Promise< RealWordPressSite > {
	await access( CLI_PATH );
	const environment = await createCliEnvironment();

	try {
		await runCliChecked(
			[
				'site',
				'create',
				'--path',
				environment.siteDirectory,
				'--name',
				SITE_NAME,
				'--runtime',
				'sandbox',
				'--admin-username',
				ADMIN_USERNAME,
				'--admin-password',
				ADMIN_PASSWORD,
				'--admin-email',
				ADMIN_EMAIL,
				'--skip-browser',
				'--skip-log-details',
			],
			environment,
			timeoutMs
		);

		await installTheme( environment, timeoutMs );
		const origin = await readSiteOrigin( environment );
		await waitForWordPress( origin, timeoutMs );

		return {
			origin,
			close: () => closeSite( environment, timeoutMs ),
		};
	} catch ( error ) {
		await closeSite( environment, timeoutMs, false );
		throw error;
	}
}

async function createCliEnvironment(): Promise< CliEnvironment > {
	const root = await mkdtemp( path.join( os.tmpdir(), 'studio-marketing-site-' ) );
	const configDirectory = path.join( root, 'config' );
	const siteDirectory = path.join( root, 'sites', 'meridian-coffee' );
	const daemonDirectory = path.join( os.tmpdir(), `sms-${ randomUUID().slice( 0, 8 ) }` );
	await Promise.all( [
		mkdir( configDirectory, { recursive: true } ),
		mkdir( path.dirname( siteDirectory ), { recursive: true } ),
		mkdir( daemonDirectory, { recursive: true } ),
	] );

	const bundledServerFiles = path.join( os.homedir(), '.studio', 'server-files' );
	const hasBundledWordPress = await pathExists(
		path.join( bundledServerFiles, 'wordpress-versions', 'latest' )
	);
	if ( hasBundledWordPress ) {
		await symlink( bundledServerFiles, path.join( configDirectory, 'server-files' ), 'junction' );
	}

	await writeFile(
		path.join( configDirectory, 'cli.json' ),
		JSON.stringify( {
			version: 1,
			sites: [],
			snapshots: [],
			...( hasBundledWordPress ? { lastDependencyCheckTime: Date.now() } : {} ),
		} )
	);

	return {
		root,
		configDirectory,
		daemonDirectory,
		siteDirectory,
		variables: {
			...process.env,
			DEV_CONFIG_DIR: configDirectory,
			STUDIO_PROCESS_MANAGER_HOME: daemonDirectory,
			E2E: '1',
			E2E_APP_DATA_PATH: root,
		},
	};
}

async function installTheme( environment: CliEnvironment, timeoutMs: number ): Promise< void > {
	const source = path.join( import.meta.dirname, 'wordpress-fixture', 'meridian-marketing' );
	const destination = path.join(
		environment.siteDirectory,
		'wp-content',
		'themes',
		'meridian-marketing'
	);
	await cp( source, destination, { recursive: true } );
	await runCliChecked(
		[ 'wp', 'theme', 'activate', 'meridian-marketing', '--path', environment.siteDirectory ],
		environment,
		timeoutMs
	);
	await runCliChecked(
		[ 'wp', 'option', 'update', 'blogname', SITE_NAME, '--path', environment.siteDirectory ],
		environment,
		timeoutMs
	);
}

async function readSiteOrigin( environment: CliEnvironment ): Promise< string > {
	const config = JSON.parse(
		await readFile( path.join( environment.configDirectory, 'cli.json' ), 'utf8' )
	) as { sites?: Array< { name?: unknown; port?: unknown } > };
	const site = config.sites?.find( ( candidate ) => candidate.name === SITE_NAME );
	if ( ! site || typeof site.port !== 'number' ) {
		throw new Error( 'The isolated Studio CLI did not persist the Meridian Coffee site port.' );
	}
	return `http://localhost:${ site.port }`;
}

async function waitForWordPress( origin: string, timeoutMs: number ): Promise< void > {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while ( Date.now() < deadline ) {
		try {
			const response = await fetch( origin );
			if ( response.ok && ( await response.text() ).includes( 'wp-site-blocks' ) ) {
				return;
			}
		} catch ( error ) {
			lastError = error;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
	}
	throw new Error( `Timed out waiting for the real WordPress site: ${ String( lastError ) }` );
}

async function closeSite(
	environment: CliEnvironment,
	timeoutMs: number,
	throwOnFailure = true
): Promise< void > {
	let stopError: unknown;
	try {
		await runCliChecked( [ 'site', 'stop', '--all' ], environment, timeoutMs );
	} catch ( error ) {
		stopError = error;
	} finally {
		await Promise.all( [
			rm( environment.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } ),
			rm( environment.daemonDirectory, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			} ),
		] );
	}
	if ( stopError && throwOnFailure ) {
		throw stopError;
	}
}

async function runCliChecked(
	args: string[],
	environment: CliEnvironment,
	timeoutMs: number
): Promise< CliResult > {
	const result = await runCli( args, environment.variables, timeoutMs );
	if ( result.code !== 0 ) {
		throw new Error(
			`Studio CLI failed (${ args.join( ' ' ) }):\n${ ( result.stderr || result.stdout ).trim() }`
		);
	}
	return result;
}

function runCli(
	args: string[],
	variables: NodeJS.ProcessEnv,
	timeoutMs: number
): Promise< CliResult > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( process.execPath, [ CLI_PATH, ...args ], {
			env: variables,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} );
		let stdout = '';
		let stderr = '';
		const timeout = setTimeout( () => {
			child.kill();
			reject( new Error( `Studio CLI timed out (${ args.join( ' ' ) }).` ) );
		}, timeoutMs );
		child.stdout.on( 'data', ( chunk ) => ( stdout += chunk.toString() ) );
		child.stderr.on( 'data', ( chunk ) => ( stderr += chunk.toString() ) );
		child.once( 'error', ( error ) => {
			clearTimeout( timeout );
			reject( error );
		} );
		child.once( 'close', ( code ) => {
			clearTimeout( timeout );
			resolve( { code, stdout, stderr } );
		} );
	} );
}

async function pathExists( target: string ): Promise< boolean > {
	try {
		await access( target );
		return true;
	} catch {
		return false;
	}
}
