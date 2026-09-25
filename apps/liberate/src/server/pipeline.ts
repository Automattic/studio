import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { platformName } from '../shared.ts';
import { UserError } from './guards.ts';
import type { Config } from './config.ts';
import type { JobProgress, Runner } from './jobs.ts';

type Log = ( event: string, data: Record< string, unknown > ) => void;

const EGRESS_GUARD = path.join( import.meta.dirname, 'network.mjs' );

/** A progress message the Studio CLI sends over its IPC channel. */
interface CliMessage {
	status?: string;
	message?: string;
}

interface RunOutput {
	code: number;
	stdout: string;
	/** Tail of stdout and stderr, interleaved. */
	output: string;
}

interface RunOptions {
	env: NodeJS.ProcessEnv;
	signal: AbortSignal;
	/** Opens an IPC channel, which makes the CLI report progress instead of drawing spinners. */
	onMessage?: ( message: CliMessage ) => void;
}

/** Run a command in its own process group, so aborting also stops everything it spawned. */
function run( command: string[], args: string[], options: RunOptions ): Promise< RunOutput > {
	const { env, signal, onMessage } = options;
	return new Promise( ( resolve, reject ) => {
		signal.throwIfAborted();
		const child = spawn( command[ 0 ], [ ...command.slice( 1 ), ...args ], {
			env,
			detached: true,
			stdio: [ 'ignore', 'pipe', 'pipe', onMessage ? 'ipc' : 'ignore' ],
		} );
		let stdout = '';
		let output = '';
		child.stdout!.on( 'data', ( chunk: Buffer ) => {
			stdout = ( stdout + chunk ).slice( -1_000_000 );
			output = ( output + chunk ).slice( -8_000 );
		} );
		child.stderr!.on( 'data', ( chunk: Buffer ) => {
			output = ( output + chunk ).slice( -8_000 );
		} );
		if ( onMessage ) {
			child.on( 'message', ( message ) => {
				const { status, message: text } = message as CliMessage;
				// Over an IPC channel the CLI reports failures as messages rather than on stderr,
				// so they only reach the log from here.
				if ( status === 'fail' || status === 'warning' ) {
					output = ( output + `${ status }: ${ text }\n` ).slice( -8_000 );
				}
				onMessage( message as CliMessage );
			} );
		}
		const kill = ( sig: NodeJS.Signals ) => {
			try {
				process.kill( -child.pid!, sig );
			} catch {
				// Already gone.
			}
		};
		const onAbort = () => {
			kill( 'SIGTERM' );
			setTimeout( () => kill( 'SIGKILL' ), 5_000 ).unref();
		};
		signal.addEventListener( 'abort', onAbort, { once: true } );
		child.on( 'error', reject );
		child.on( 'close', ( code ) => {
			signal.removeEventListener( 'abort', onAbort );
			if ( signal.aborted ) {
				reject( signal.reason );
			} else {
				resolve( { code: code ?? 1, stdout, output } );
			}
		} );
	} );
}

/**
 * Environment for the Studio CLI: its state lives on the data volume, isolated
 * from any Studio install on the same machine.
 */
function studioEnv( config: Config ): NodeJS.ProcessEnv {
	const key = createHash( 'sha256' ).update( config.dataDir ).digest( 'hex' ).slice( 0, 8 );
	// The Studio daemon creates Unix sockets in these directories, and socket paths can't
	// exceed 104 bytes on macOS, so they live under the short system temp directory.
	const runDir = path.join( os.tmpdir(), `liberate-${ key }` );
	return {
		...process.env,
		DEV_CONFIG_DIR: path.join( config.dataDir, 'studio' ),
		STUDIO_PROCESS_MANAGER_HOME: path.join( runDir, 'daemon' ),
		// The daemon inherits this from whichever process starts it, so it must not be per job.
		TMPDIR: path.join( runDir, 'tmp' ),
		CI: '1',
		NO_COLOR: '1',
		// The container runs as root, and WP-CLI refuses to run as root without this.
		WP_CLI_ALLOW_ROOT: '1',
		LIBERATE_EGRESS_GUARD: '1',
		// Where `localhost` resolves to ::1 first, as it does in the container, a Studio site's
		// server binds IPv6 only while everything that talks to it asks for 127.0.0.1, and the
		// site never comes up.
		NODE_OPTIONS: `${
			process.env.NODE_OPTIONS ?? ''
		} --dns-result-order=ipv4first --import="${ EGRESS_GUARD }"`.trim(),
	};
}

/** A JavaScript entry point needs the current Node; a plain command is run as it is. */
function studioCommand( config: Config ): string[] {
	return /\.(mjs|js)$/.test( config.studioCli )
		? [ process.execPath, config.studioCli ]
		: [ config.studioCli ];
}

const studio = (
	config: Config,
	env: NodeJS.ProcessEnv,
	args: string[],
	signal: AbortSignal,
	onMessage?: ( message: CliMessage ) => void
) => run( studioCommand( config ), args, { env, signal, onMessage } );

async function expectSuccess( result: Promise< RunOutput >, what: string ) {
	const { code, output } = await result;
	if ( code !== 0 ) {
		throw new Error( `${ what } exited with ${ code }: ${ output.slice( -2_000 ) }` );
	}
}

interface StudioSite {
	path: string;
	url: string;
	running: boolean;
}

async function listSites( config: Config, env: NodeJS.ProcessEnv, signal: AbortSignal ) {
	const { stdout } = await studio( config, env, [ 'site', 'list', '--format', 'json' ], signal );
	const json = stdout.split( '\n' ).find( ( line ) => line.startsWith( '[' ) );
	return ( json ? JSON.parse( json ) : [] ) as StudioSite[];
}

/** Stop and unregister the Studio sites whose path matches, leaving their files alone. */
async function forgetSites( config: Config, env: NodeJS.ProcessEnv, prefix: string ) {
	const signal = AbortSignal.timeout( 180_000 );
	for ( const site of await listSites( config, env, signal ) ) {
		if ( ! path.resolve( site.path ).startsWith( prefix ) ) {
			continue;
		}
		if ( site.running ) {
			await studio( config, env, [ 'site', 'stop', '--path', site.path ], signal );
		}
		await studio( config, env, [ 'site', 'delete', site.path, '--no-files' ], signal );
	}
}

/** One-time setup at boot, before any job runs. */
export async function prepareStudio( config: Config ) {
	const env = studioEnv( config );
	await fs.promises.mkdir( env.DEV_CONFIG_DIR!, { recursive: true } );
	await fs.promises.mkdir( env.TMPDIR!, { recursive: true } );
	// Opt the server's Studio CLI out of analytics. No Studio process is running yet, and
	// the exclusive flag leaves an existing file alone.
	await fs.promises
		.writeFile(
			path.join( env.DEV_CONFIG_DIR!, 'shared.json' ),
			JSON.stringify( { version: 1, analyticsOptOut: true } ),
			{ flag: 'wx' }
		)
		.catch( ( error ) => {
			if ( error.code !== 'EEXIST' ) {
				throw error;
			}
		} );
	// Sites left over from jobs interrupted by a crash or a deploy.
	await forgetSites( config, env, path.resolve( config.dataDir ) );
}

const GENERIC_TITLE = /^(home|home ?page|welcome|index|untitled|imported site)$/i;

/**
 * The site's name from its WordPress title, which can be a page title like
 * "Home | Acme Coffee". Undefined when there's no usable name.
 */
export function siteNameFrom( title: unknown ): string | undefined {
	if ( typeof title !== 'string' ) {
		return undefined;
	}
	const name = title
		.split( /\s+[|–—·-]\s+/ )
		.map( ( part ) => part.replace( /\s+/g, ' ' ).trim() )
		.find( ( part ) => part && ! GENERIC_TITLE.test( part ) );
	return name && name.length <= 40 ? name : undefined;
}

/**
 * Turn one of the Studio CLI's progress messages into job progress. Capture messages
 * carry their own counts (`[liberate] 3/21 <url>`); the rest name a phase.
 */
export function progressFrom( message: string ): JobProgress | undefined {
	const captured = message.match( /^\[liberate] (\d+)\/(\d+)/ );
	if ( captured ) {
		const [ , done, total ] = captured.map( Number );
		return {
			step: 'capture',
			progress: 0.08 + ( 0.5 * done ) / Math.max( 1, total ),
			detail: `Copied ${ done } of ${ total } pages`,
			counts: { pages: done },
		};
	}
	if ( /^\[liberate] (finalizing|complete)/.test( message ) ) {
		return { step: 'capture', progress: 0.6, detail: 'Finishing the copy…' };
	}
	if (
		/^\[liberate]/.test( message ) ||
		/^(Preparing source website|Data Liberation)/.test( message )
	) {
		return { step: 'scan', progress: 0.05, detail: 'Looking at your site…' };
	}
	if ( /^Static site import/.test( message ) ) {
		return { step: 'import', progress: 0.68, detail: 'Rebuilding it as WordPress…' };
	}
	if ( /^Finalization/.test( message ) ) {
		return { step: 'import', progress: 0.78, detail: 'Finishing the WordPress site…' };
	}
	return undefined;
}

/** What the capture recorded about the source site: its own title and platform. */
export function readCapture( sourceDir: string ): { title?: string; platform?: string } {
	try {
		const [ file ] = fs.globSync( path.join( sourceDir, '*', 'capture-receipt.json' ) );
		const receipt = JSON.parse( fs.readFileSync( file, 'utf8' ) );
		return { title: receipt.title, platform: platformName( receipt.source?.platform ) };
	} catch {
		return {};
	}
}

const QUALITY_WARNING =
	'Parts of this site didn’t convert cleanly, so some pages may be missing pieces.';

export function createPipeline( config: Config, log: Log ): Runner {
	const env = studioEnv( config );

	return async ( job, { workDir, filesDir, signal, report } ) => {
		const sitesDir = path.join( workDir, 'sites' );
		const slug =
			job.host
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-|-$/g, '' )
				.slice( 0, 40 ) || 'site';
		const sitePath = path.join( sitesDir, slug );
		await fs.promises.mkdir( sitesDir, { recursive: true } );

		let pages = 0;
		report( { step: 'scan', progress: 0.02, detail: 'Looking at your site…' } );
		try {
			const created = await studio(
				config,
				env,
				[
					'site',
					'create',
					'--name',
					slug,
					'--path',
					sitePath,
					'--from',
					job.url,
					// The capture is the only place the site's own name and platform are recorded.
					'--keep-source',
					'--skip-browser',
					'--skip-log-details',
				],
				signal,
				( message ) => {
					const progress = progressFrom( String( message.message ?? '' ) );
					if ( progress ) {
						pages = progress.counts?.pages ?? pages;
						report( progress );
					}
				}
			);

			const site = ( await listSites( config, env, signal ) ).find(
				( candidate ) => path.resolve( candidate.path ) === path.resolve( sitePath )
			);
			if ( ! site ) {
				log( 'create_failed', {
					id: job.id,
					code: created.code,
					output: created.output.slice( -2_000 ),
				} );
				throw /could not capture|unsupported|no routes|could not resolve/i.test( created.output )
					? new UserError( 'We couldn’t copy this site. It may block automated visits.' )
					: new Error( `studio site create exited with ${ created.code }` );
			}
			// The importer's quality gate can reject a site that is still worth having, so the
			// job continues with a warning rather than losing everything it captured.
			const warning = created.code === 0 ? undefined : QUALITY_WARNING;
			if ( warning ) {
				log( 'import_warning', { id: job.id, output: created.output.slice( -2_000 ) } );
			}

			report( { step: 'package', progress: 0.85, detail: 'Packing your WordPress site…' } );
			const capture = readCapture( `${ sitePath }-source` );
			await studio( config, env, [ 'site', 'stop', '--path', sitePath ], signal );

			// Point the backup at the site's real address instead of the temporary local one.
			const origin = new URL( job.url ).origin;
			for ( const [ from, to ] of [
				[ site.url, origin ],
				[ site.url.replaceAll( '/', '\\/' ), origin.replaceAll( '/', '\\/' ) ],
			] ) {
				await expectSuccess(
					studio(
						config,
						env,
						[
							'wp',
							'--path',
							sitePath,
							'search-replace',
							from,
							to,
							'--skip-columns=guid',
							'--skip-plugins',
							'--skip-themes',
						],
						signal
					),
					'search-replace'
				);
			}

			// The importer leaves its working data and a per-run report behind: hundreds of
			// megabytes that only make the download bigger.
			for ( const debris of [
				path.join( sitePath, 'wp-content', 'static-site-importer' ),
				...fs.globSync( path.join( sitePath, 'wp-content', 'themes', '*', 'import-report.json' ) ),
			] ) {
				await fs.promises.rm( debris, { recursive: true, force: true } );
			}

			const siteZip = path.join( filesDir, 'site.zip' );
			await expectSuccess(
				studio( config, env, [ 'export', siteZip, '--path', sitePath, '--mode', 'full' ], signal ),
				'studio export'
			);

			return {
				siteName: siteNameFrom( capture.title ),
				platform: capture.platform,
				counts: { pages },
				warning,
				files: { site: fs.statSync( siteZip ).size },
			};
		} finally {
			await forgetSites( config, env, path.resolve( sitesDir ) ).catch( ( error ) =>
				log( 'studio_cleanup_failed', { id: job.id, error: String( error ) } )
			);
		}
	};
}

/**
 * Simulated jobs, for working on the UI without crawling real sites. Hosts
 * containing "fail" fail after the scan, and the download is a placeholder.
 */
export const fakePipeline: Runner = async ( job, { filesDir, signal, report } ) => {
	const label = job.host.replace( /^www\./, '' ).split( '.' )[ 0 ];
	const siteName = label.charAt( 0 ).toUpperCase() + label.slice( 1 );
	report( { step: 'scan', progress: 0.02, detail: 'Looking at your site…' } );
	await sleep( 2_500, undefined, { signal } );
	if ( job.host.includes( 'fail' ) ) {
		throw new UserError( 'We couldn’t copy this site. It may block automated visits.' );
	}
	for ( let done = 1; done <= 21; done++ ) {
		report( { siteName, ...progressFrom( `[liberate] ${ done }/21 ${ job.url }` )! } );
		await sleep( 400, undefined, { signal } );
	}
	for ( const message of [ 'Static site import… 12 sec elapsed', 'Finalization… 3 sec elapsed' ] ) {
		report( progressFrom( message )! );
		await sleep( 1_500, undefined, { signal } );
	}
	report( { step: 'package', progress: 0.85, detail: 'Packing your WordPress site…' } );
	const target = path.join( filesDir, 'site.zip' );
	await fs.promises.writeFile(
		target,
		`A placeholder from a simulated liberate.sh run (LIBERATE_FAKE_PIPELINE=1) for ${ job.url }.\n`
	);
	return { siteName, counts: { pages: 21 }, files: { site: fs.statSync( target ).size } };
};
