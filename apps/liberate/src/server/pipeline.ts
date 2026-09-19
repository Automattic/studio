import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ZipArchive } from 'archiver';
import { platformName, type JobCounts } from '../shared.ts';
import { UserError } from './guards.ts';
import type { Config } from './config.ts';
import type { JobProgress, JobResult, Runner } from './jobs.ts';

type Log = ( event: string, data: Record< string, unknown > ) => void;

const TSX_CLI = createRequire( import.meta.url ).resolve( 'tsx/cli' );
const EGRESS_GUARD = path.join( import.meta.dirname, 'network.mjs' );

interface RunOutput {
	code: number;
	stdout: string;
	/** Tail of stdout and stderr, interleaved. */
	output: string;
}

/** Run a command in its own process group, so aborting also stops everything it spawned. */
function run(
	command: string,
	args: string[],
	options: { env: NodeJS.ProcessEnv; signal: AbortSignal; logFile?: string }
): Promise< RunOutput > {
	const { env, signal, logFile } = options;
	return new Promise( ( resolve, reject ) => {
		signal.throwIfAborted();
		const child = spawn( command, args, {
			env,
			detached: true,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} );
		const log = logFile ? fs.createWriteStream( logFile, { flags: 'a' } ) : undefined;
		let stdout = '';
		let output = '';
		child.stdout.on( 'data', ( chunk: Buffer ) => {
			log?.write( chunk );
			stdout = ( stdout + chunk ).slice( -1_000_000 );
			output = ( output + chunk ).slice( -8_000 );
		} );
		child.stderr.on( 'data', ( chunk: Buffer ) => {
			log?.write( chunk );
			output = ( output + chunk ).slice( -8_000 );
		} );
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
			log?.end();
			if ( signal.aborted ) {
				reject( signal.reason );
			} else {
				resolve( { code: code ?? 1, stdout, output } );
			}
		} );
	} );
}

async function expectSuccess( result: Promise< RunOutput >, what: string ) {
	const { code, output } = await result;
	if ( code !== 0 ) {
		throw new Error( `${ what } exited with ${ code }: ${ output.slice( -2_000 ) }` );
	}
}

/**
 * Environment for data-liberation and the Studio CLI: Studio state lives on the
 * data volume, isolated from any Studio install on the same machine.
 */
function studioEnv( config: Config ): NodeJS.ProcessEnv {
	const key = createHash( 'sha256' ).update( config.dataDir ).digest( 'hex' ).slice( 0, 8 );
	// The Studio daemon and tsx create Unix sockets in these directories, and socket paths
	// can't exceed 104 bytes on macOS, so they live under the short system temp directory.
	const runDir = path.join( os.tmpdir(), `liberate-${ key }` );
	return {
		...process.env,
		DEV_CONFIG_DIR: path.join( config.dataDir, 'studio' ),
		STUDIO_PROCESS_MANAGER_HOME: path.join( runDir, 'daemon' ),
		// The daemon inherits this from whichever process starts it, so it must not be per job.
		TMPDIR: path.join( runDir, 'tmp' ),
		CI: '1',
		NO_COLOR: '1',
		DLA_AGENT_CLI: 'none',
		// Only agent-composed pages need the block fixer, which npm-installs itself on first use.
		DLA_BLOCK_FIXER: '0',
		LIBERATE_EGRESS_GUARD: '1',
		NODE_OPTIONS: `${ process.env.NODE_OPTIONS ?? '' } --import="${ EGRESS_GUARD }"`.trim(),
	};
}

const studio = ( env: NodeJS.ProcessEnv, args: string[], signal: AbortSignal ) =>
	run( 'studio', args, { env, signal } );

/** Stop and unregister the Studio sites whose path matches, leaving their files alone. */
async function forgetSites( env: NodeJS.ProcessEnv, matches: ( sitePath: string ) => boolean ) {
	const signal = AbortSignal.timeout( 120_000 );
	const { stdout } = await studio( env, [ 'site', 'list', '--format', 'json' ], signal );
	const json = stdout.split( '\n' ).find( ( line ) => line.startsWith( '[' ) );
	const sites = ( json ? JSON.parse( json ) : [] ) as { path: string; running: boolean }[];
	for ( const site of sites.filter( ( { path: sitePath } ) => matches( sitePath ) ) ) {
		if ( site.running ) {
			await studio( env, [ 'site', 'stop', '--path', site.path ], signal );
		}
		await studio( env, [ 'site', 'delete', site.path, '--no-files' ], signal );
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
	await forgetSites( env, () => true );
}

interface Summary {
	siteName?: string;
	discovered?: number;
	/** URLs that will be copied: the discovered ones, up to the page cap. */
	total?: number;
	installed: number;
	counts: JobCounts;
	site?: { path: string; url: string };
	lookDone: boolean;
	noAdapter: boolean;
}

const GENERIC_TITLE = /^(home|home ?page|welcome|index|untitled|imported site)$/i;

/**
 * The site's name from the title data-liberation found, which can be a page
 * title like "Home | Acme Coffee". Undefined when there's no usable name.
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

/** Summarize data-liberation's `watch.log`, the only machine-readable progress it writes. */
export function summarizeWatchLog( log: string, maxPages: number ): Summary {
	const summary: Summary = {
		installed: 0,
		counts: { pages: 0, posts: 0, media: 0, products: 0 },
		lookDone: false,
		noAdapter: false,
	};
	const archetypes = new Map< string, unknown >();
	const installed = new Set< string >();
	for ( const line of log.split( '\n' ) ) {
		let entry: Record< string, unknown >;
		try {
			entry = JSON.parse( line );
		} catch {
			continue;
		}
		const url = String( entry.url );
		switch ( entry.event ) {
			case 'discovered':
				summary.discovered = Number( entry.count ) || 0;
				summary.total = Math.min( summary.discovered, maxPages );
				break;
			case 'no-adapter':
				summary.noAdapter = true;
				break;
			case 'site-options-updated':
				summary.siteName = siteNameFrom( entry.title );
				break;
			case 'preview-pre-started':
				summary.site = { path: String( entry.sitePath ), url };
				break;
			case 'post-queued':
				archetypes.set( url, entry.archetype );
				break;
			case 'post-installed':
				if ( ! entry.error && ! installed.has( url ) ) {
					installed.add( url );
					const type = archetypes.get( url );
					summary.counts[ type === 'post' ? 'posts' : type === 'product' ? 'products' : 'pages' ]++;
				}
				break;
			case 'media-installed':
			case 'css-media-installed':
				summary.counts.media = Math.max( summary.counts.media, Number( entry.installed ) || 0 );
				break;
			case 'design-theme-installed':
			case 'design-theme-install-failed':
				summary.lookDone = true;
				break;
		}
	}
	summary.installed = installed.size;
	return summary;
}

export function progressOf( summary: Summary ): JobProgress {
	const { discovered, total, installed, counts } = summary;
	if ( total === undefined ) {
		return { step: 'scan', progress: 0.03, detail: 'Looking at your site…' };
	}
	if ( installed < total && ! summary.lookDone ) {
		const found =
			discovered! > total
				? `Found ${ discovered } pages. Copying the first ${ total }…`
				: `Found ${ total } pages. Copying them…`;
		return {
			step: 'content',
			progress: 0.08 + ( 0.72 * installed ) / total,
			detail: installed ? `Copied ${ installed } of ${ total } pages` : found,
			counts,
		};
	}
	return { step: 'look', progress: 0.84, detail: 'Recreating the look…', counts };
}

const readme = ( url: string, hasProducts: boolean ) =>
	[
		`Your content from ${ url }, liberated by liberate.sh.`,
		'',
		'content.xml     Pages, posts and menus in the WordPress export format (WXR).',
		'media/          Copies of your images and files.',
		'redirects.json  Your old addresses, mapped to the new WordPress ones.',
		...( hasProducts ? [ 'products.csv    Your products, ready for WooCommerce.' ] : [] ),
		'',
		'Import it into any WordPress site, including free WordPress.com sites:',
		'',
		'1. In your dashboard, go to Tools > Import > WordPress.',
		'2. Upload content.xml and tick "Download and import file attachments".',
		'   Images are fetched from your old site, so import before you close it.',
		'3. Imported pages and posts start as drafts, so you can review them first.',
		...( hasProducts
			? [ '4. Install WooCommerce, go to Products > Import and upload products.csv.' ]
			: [] ),
		'',
		`The full site, design included, is in ${ new URL( url ).hostname }-wordpress.zip.`,
		'',
	].join( '\n' );

async function writeZip( target: string, fill: ( archive: ZipArchive ) => void ) {
	const archive = new ZipArchive( { zlib: { level: 6 } } );
	const output = fs.createWriteStream( target );
	const done = new Promise< void >( ( resolve, reject ) => {
		output.on( 'close', () => resolve() );
		output.on( 'error', reject );
		archive.on( 'error', reject );
	} );
	archive.pipe( output );
	fill( archive );
	await archive.finalize();
	await done;
}

/** Zip the portable content: WXR, media, redirects and products. */
function zipContent( outDir: string, target: string, url: string ) {
	const has = ( name: string ) => fs.existsSync( path.join( outDir, name ) );
	return writeZip( target, ( archive ) => {
		archive.append( readme( url, has( 'products.csv' ) ), { name: 'README.txt' } );
		archive.file( path.join( outDir, 'output.wxr' ), { name: 'content.xml' } );
		for ( const [ source, name ] of [
			[ 'redirect-map.json', 'redirects.json' ],
			[ 'products.csv', 'products.csv' ],
		] ) {
			if ( has( source ) ) {
				archive.file( path.join( outDir, source ), { name } );
			}
		}
		if ( has( 'media' ) ) {
			archive.directory( path.join( outDir, 'media' ), 'media' );
		}
	} );
}

const fileSize = ( file: string ) => fs.statSync( file ).size;

function readText( file: string ) {
	try {
		return fs.readFileSync( file, 'utf8' );
	} catch {
		return '';
	}
}

export function createPipeline( config: Config, log: Log ): Runner {
	const env = studioEnv( config );

	return async ( job, { workDir, filesDir, signal, report } ) => {
		const outBase = path.join( workDir, 'out' );
		const sitesDir = path.join( workDir, 'sites' );
		let outDir: string | undefined;
		let platform: string | undefined;
		// data-liberation writes into a single sub-directory named after the site.
		const read = () => {
			if ( ! outDir ) {
				const entry = fs
					.readdirSync( outBase, { withFileTypes: true } )
					.find( ( dirent ) => dirent.isDirectory() );
				outDir = entry && path.join( outBase, entry.name );
			}
			if ( ! outDir ) {
				return undefined;
			}
			try {
				platform ??= JSON.parse( readText( path.join( outDir, 'session.json' ) ) ).adapter;
			} catch {
				// Not written yet.
			}
			return summarizeWatchLog( readText( path.join( outDir, 'watch.log' ) ), config.maxPages );
		};

		await fs.promises.mkdir( outBase, { recursive: true } );
		report( { step: 'scan', progress: 0.02, detail: 'Looking at your site…' } );
		const timer = setInterval( () => {
			try {
				const summary = read();
				if ( summary ) {
					report( {
						platform: platformName( platform ),
						siteName: summary.siteName,
						...progressOf( summary ),
					} );
				}
			} catch {
				// Files mid-write; the next tick will catch up.
			}
		}, 2_000 );

		try {
			const liberation = await run(
				process.execPath,
				[
					TSX_CLI,
					config.dlaCli,
					job.url,
					'--non-interactive',
					'--no-agent',
					'--limit',
					String( config.maxPages ),
					'--output',
					outBase,
				],
				{
					env: { ...env, DLA_OUTPUT_DIR: outBase, STUDIO_SITES_DIR: sitesDir },
					signal,
					logFile: path.join( workDir, 'liberation.log' ),
				}
			);
			clearInterval( timer );

			const summary = read();
			if ( summary?.noAdapter || summary?.discovered === 0 ) {
				throw new UserError( 'We couldn’t find any pages to copy on this site.' );
			}
			// Exit code 0 doesn't mean success: failures only show up in watch.log.
			if ( liberation.code !== 0 || ! summary?.site || ! outDir ) {
				throw new Error(
					`Liberation failed (exit ${ liberation.code }): ${ liberation.output.slice( -2_000 ) }`
				);
			}
			if ( ! summary.installed ) {
				throw new UserError( 'We couldn’t copy any pages from this site.' );
			}

			report( {
				step: 'package',
				progress: 0.9,
				detail: 'Packing your WordPress site…',
				counts: summary.counts,
			} );
			const site = summary.site;
			await studio( env, [ 'site', 'stop', '--path', site.path ], signal );
			// Point the backup at the site's real address instead of the temporary local one.
			const origin = new URL( job.url ).origin;
			for ( const [ from, to ] of [
				[ site.url, origin ],
				[ site.url.replaceAll( '/', '\\/' ), origin.replaceAll( '/', '\\/' ) ],
			] ) {
				await expectSuccess(
					studio(
						env,
						[
							'wp',
							'--path',
							site.path,
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
			const siteZip = path.join( filesDir, 'site.zip' );
			await expectSuccess(
				studio( env, [ 'export', siteZip, '--path', site.path, '--mode', 'full' ], signal ),
				'studio export'
			);

			report( { progress: 0.97, detail: 'Packing your content…' } );
			const contentZip = path.join( filesDir, 'content.zip' );
			await zipContent( outDir, contentZip, job.url );

			return {
				siteName: summary.siteName,
				platform: platformName( platform ),
				counts: summary.counts,
				truncated: ( summary.discovered ?? 0 ) > config.maxPages,
				files: { site: fileSize( siteZip ), content: fileSize( contentZip ) },
			};
		} catch ( error ) {
			if ( ! signal.aborted && ! ( error instanceof UserError ) ) {
				log( 'liberation_log', {
					id: job.id,
					watchLog: outDir ? readText( path.join( outDir, 'watch.log' ) ).slice( -4_000 ) : '',
				} );
			}
			throw error;
		} finally {
			clearInterval( timer );
			await forgetSites( env, ( sitePath ) => sitePath.startsWith( sitesDir ) ).catch( ( error ) =>
				log( 'studio_cleanup_failed', { id: job.id, error: String( error ) } )
			);
		}
	};
}

/**
 * Simulated jobs, for working on the UI without crawling real sites. Hosts
 * containing "fail" fail after the scan, and the downloads are placeholders.
 */
export const fakePipeline: Runner = async ( job, { filesDir, signal, report } ) => {
	const summary: Summary = {
		discovered: 24,
		total: 24,
		installed: 0,
		counts: { pages: 0, posts: 0, media: 0, products: 0 },
		lookDone: false,
		noAdapter: false,
	};
	const label = job.host.replace( /^www\./, '' ).split( '.' )[ 0 ];
	const siteName = label.charAt( 0 ).toUpperCase() + label.slice( 1 );
	report( { step: 'scan', progress: 0.02, detail: 'Looking at your site…' } );
	await sleep( 2_500, undefined, { signal } );
	if ( job.host.includes( 'fail' ) ) {
		throw new UserError( 'We couldn’t find any pages to copy on this site.' );
	}
	for ( let installed = 0; installed <= 24; installed++ ) {
		Object.assign( summary, { installed } );
		summary.counts = {
			pages: Math.min( installed, 9 ),
			posts: Math.max( 0, installed - 9 ),
			media: installed * 3,
			products: 0,
		};
		report( { platform: 'Wix', siteName, ...progressOf( summary ) } );
		await sleep( 400, undefined, { signal } );
	}
	report( progressOf( { ...summary, lookDone: true } ) );
	await sleep( 2_000, undefined, { signal } );
	report( { step: 'package', progress: 0.9, detail: 'Packing your WordPress site…' } );
	await sleep( 2_000, undefined, { signal } );
	const files: JobResult[ 'files' ] = {};
	for ( const kind of [ 'site', 'content' ] as const ) {
		const target = path.join( filesDir, `${ kind }.zip` );
		await writeZip( target, ( archive ) =>
			archive.append(
				`A placeholder from a simulated liberate.sh run (LIBERATE_FAKE_PIPELINE=1) for ${ job.url }.\nIt is not a WordPress site: run the real pipeline to get one.\n`,
				{ name: 'SIMULATED.txt' }
			)
		);
		files[ kind ] = fileSize( target );
	}
	return { siteName, platform: 'Wix', counts: summary.counts, truncated: false, files };
};
