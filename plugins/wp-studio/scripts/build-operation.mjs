#!/usr/bin/env node
// PROTOTYPE: one foreground operation owns the engine and Studio command lifecycle.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const TRANSPORTS = {
	codex: [ 'codex-cli', 'openai' ],
	claude: [ 'claude-cli', 'anthropic' ],
	grok: [ 'grok-cli', 'xai' ],
};
const read = ( file ) => JSON.parse( fs.readFileSync( file, 'utf8' ) );
const now = () => new Date().toISOString();
const terminal = new Set( [ 'ready', 'published', 'failed', 'interrupted', 'publication_failed' ] );
const HELPER = fileURLToPath( new URL( './image-bridge.mjs', import.meta.url ) );
const DEFAULT_ENGINE_HOME = fileURLToPath(
	new URL( '../../../../site-builder-engine', import.meta.url )
);

function atomicJson( file, value ) {
	const temp = file + '.' + randomUUID() + '.tmp';
	fs.writeFileSync( temp, JSON.stringify( value, null, 2 ) + '\n', { mode: 0o600, flag: 'wx' } );
	fs.renameSync( temp, file );
}

export function normalizeSpec( spec ) {
	const allowed = [
		'prompt',
		'name',
		'slug',
		'harness',
		'engineHome',
		'images',
		'singlePage',
		'designFallback',
		'engineArguments',
		'studioCommand',
		'publish',
	];
	for ( const key of Object.keys( spec ) )
		if ( ! allowed.includes( key ) ) throw new Error( 'Unknown build field: ' + key );
	if ( spec.publish ) {
		validateRemoteSite( spec.publish.remoteSite );
		if ( ! [ 'preserve', 'private' ].includes( spec.publish.visibility ?? 'preserve' ) )
			throw new Error( 'Publishing visibility must be preserve or private.' );
	}
	if ( ! Object.hasOwn( TRANSPORTS, spec.harness ) )
		throw new Error( 'Declare the current harness: codex, claude, or grok.' );
	if (
		typeof spec.prompt !== 'string' ||
		! spec.prompt.trim() ||
		Buffer.byteLength( spec.prompt ) > 65536
	)
		throw new Error( 'Provide a nonempty prompt under 64 KiB.' );
	if ( typeof spec.name !== 'string' || ! spec.name.trim() )
		throw new Error( 'Provide the site name.' );
	if ( ! /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test( spec.slug ?? '' ) )
		throw new Error( 'Use a lowercase, dash-separated fresh slug.' );
	if ( spec.images !== undefined && ! [ 'harness', 'none' ].includes( spec.images ) )
		throw new Error( 'images must be harness or none.' );
	for ( const key of [ 'singlePage', 'designFallback' ] )
		if ( spec[ key ] !== undefined && typeof spec[ key ] !== 'boolean' )
			throw new Error( key + ' must be boolean.' );
	const args = spec.engineArguments ?? [];
	if (
		! Array.isArray( args ) ||
		args.some( ( a ) => typeof a !== 'string' || ! /^--[a-z][a-z0-9-]*(?:=.*)?$/s.test( a ) )
	)
		throw new Error( 'engineArguments must be --flag or --flag=value entries.' );
	const owned =
		/^(?:slug|prompt-file|provider|serve|no-serve|with-images|single-page|multi-page|studio-design-fallback|step|from|until|resume|protocol|transport|list-steps|help|existing-content-file|existing-scope|existing-candidate)$/;
	for ( const arg of args )
		if ( owned.test( arg.slice( 2 ).split( '=' )[ 0 ] ) )
			throw new Error( 'The operation owns this flag or does not support this workflow: ' + arg );
	const engineHome = path.resolve(
		spec.engineHome ?? process.env.SITE_BUILD_HOME ?? DEFAULT_ENGINE_HOME
	);
	const developmentCli = fileURLToPath(
		new URL( '../../../apps/cli/dist/cli/main.mjs', import.meta.url )
	);
	const studioCommand =
		spec.studioCommand ??
		( process.env.STUDIO_CLI_BIN
			? [ process.execPath, path.resolve( process.env.STUDIO_CLI_BIN ) ]
			: fs.existsSync( developmentCli )
			? [ process.execPath, developmentCli ]
			: [ 'studio' ] );
	if (
		! Array.isArray( studioCommand ) ||
		! studioCommand.length ||
		studioCommand.some( ( a ) => typeof a !== 'string' || ! a || a.includes( '\0' ) )
	)
		throw new Error( 'studioCommand must be an argv array.' );
	return {
		...spec,
		engineHome,
		studioCommand,
		engineArguments: args,
		images: spec.images ?? 'none',
	};
}

export function pendingImages( directory ) {
	const requests = path.join( directory, 'images', 'requests' );
	if ( ! fs.existsSync( requests ) ) return [];
	return fs
		.readdirSync( requests )
		.filter( ( f ) => /^[a-f0-9]{32}\.json$/.test( f ) )
		.map( ( f ) => read( path.join( requests, f ) ) )
		.filter(
			( r ) =>
				r.v === 1 &&
				/^[a-f0-9]{32}$/.test( r.id ) &&
				r.expiresAt > Date.now() / 1000 &&
				! fs.existsSync( path.join( directory, 'images', 'responses', r.id + '.json' ) )
		)
		.map( ( r ) => ( {
			...r,
			claimed: fs.existsSync( path.join( directory, 'images', 'claims', r.id + '.json' ) ),
		} ) );
}

export function claimImage( directory, id ) {
	const state = getStatus( directory );
	if ( terminal.has( state.phase ) || state.interrupted )
		throw new Error( 'The operation is not accepting images.' );
	const request = pendingImages( directory ).find( ( r ) => r.id === id );
	if ( ! request ) throw new Error( 'Image request is closed, expired, or unknown.' );
	const claims = path.join( directory, 'images', 'claims' );
	fs.mkdirSync( claims, { recursive: true } );
	fs.writeFileSync( path.join( claims, id + '.json' ), JSON.stringify( { claimedAt: now() } ), {
		flag: 'wx',
		mode: 0o600,
	} );
	return request;
}

export function getStatus( directory ) {
	const status = read( path.join( directory, 'status.json' ) );
	const imageRequests = terminal.has( status.phase ) ? [] : pendingImages( directory );
	let ownerAlive = false;
	try {
		process.kill( status.pid, 0 );
		ownerAlive = true;
	} catch ( error ) {
		if ( error.code === 'EPERM' ) ownerAlive = true;
	}
	return {
		...status,
		ownerAlive,
		interrupted: ! terminal.has( status.phase ) && ! ownerAlive,
		imageRequests,
	};
}

export function launch(
	command,
	args,
	{ cwd, env, logFile, timeoutMs = 30 * 60 * 1000, onStdoutLine } = {}
) {
	const child = spawn( command, args, {
		cwd,
		env,
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		detached: process.platform !== 'win32',
	} );
	let stdout = '',
		stderr = '';
	const log = logFile ? fs.openSync( logFile, 'a', 0o600 ) : null;
	let lineBuffer = '',
		observerError = null;
	const collect = ( chunk, stream ) => {
		const text = chunk.toString().replace( /("adminPassword"\s*:\s*")[^"]*"/g, '$1[redacted]"' );
		if ( log !== null ) fs.writeSync( log, text );
		if ( stream === 'stdout' ) stdout = ( stdout + text ).slice( -1048576 );
		else stderr = ( stderr + text ).slice( -1048576 );
		if ( stream === 'stdout' && onStdoutLine && ! observerError ) {
			lineBuffer += text;
			const lines = lineBuffer.split( '\n' );
			lineBuffer = lines.pop();
			for ( const line of lines ) {
				try {
					onStdoutLine( line );
				} catch ( error ) {
					observerError = error.message;
				}
			}
			if ( lineBuffer.length > 1048576 ) {
				observerError = 'Publication event exceeded 1 MiB.';
				lineBuffer = '';
			}
		}
	};
	child.stdout.on( 'data', ( chunk ) => collect( chunk, 'stdout' ) );
	child.stderr.on( 'data', ( chunk ) => collect( chunk, 'stderr' ) );
	let stopped = false;
	let forceTimer;
	const stop = () => {
		if ( stopped ) return;
		stopped = true;
		try {
			if ( process.platform !== 'win32' ) process.kill( -child.pid, 'SIGTERM' );
			else child.kill( 'SIGTERM' );
		} catch {
			// The process group may already have exited.
		}
		forceTimer = setTimeout( () => {
			try {
				if ( process.platform !== 'win32' ) process.kill( -child.pid, 'SIGKILL' );
				else child.kill( 'SIGKILL' );
			} catch {
				/* Already exited. */
			}
		}, 5000 );
	};
	const timer = timeoutMs > 0 ? setTimeout( stop, timeoutMs ) : null;
	const done = new Promise( ( resolve ) => {
		let error = null;
		child.on( 'error', ( e ) => {
			error = e;
		} );
		child.on( 'close', ( code ) => {
			clearTimeout( timer );
			clearTimeout( forceTimer );
			if ( log !== null ) fs.closeSync( log );
			resolve( {
				code: code ?? 1,
				stdout,
				stderr: error?.message ?? stderr,
				stopped,
				observerError,
			} );
		} );
	} );
	return { done, stop, requestCancel: () => child.kill( 'SIGTERM' ) };
}

function lastJson( text ) {
	for ( const line of text.trim().split( '\n' ).reverse() ) {
		try {
			const value = JSON.parse( line );
			if ( value && typeof value === 'object' ) return value;
		} catch {
			// Studio may print progress before its final JSON receipt.
		}
	}
	throw new Error( 'Command did not return a JSON result.' );
}

export function journalSummary( file ) {
	if ( ! fs.existsSync( file ) )
		return { runId: null, completed: false, step: null, warnings: [], progress: null };
	const events = fs
		.readFileSync( file, 'utf8' )
		.split( '\n' )
		.filter( Boolean )
		.flatMap( ( line ) => {
			try {
				return [ JSON.parse( line ) ];
			} catch {
				return [];
			}
		} );
	const started = events.findLast( ( e ) => e.type === 'build.started' );
	const current = events.filter( ( e ) => e.runId === started?.runId );
	const steps = started?.data?.steps ?? [];
	const completed = new Set(
		current.filter( ( e ) => e.type === 'step.completed' ).map( ( e ) => e.data.id )
	);
	return {
		runId: started?.runId ?? null,
		completed: current.some(
			( e ) => e.type === 'build.completed' && e.data.stoppedAfter === null
		),
		step: current.findLast( ( e ) => e.type === 'step.started' )?.data.id ?? null,
		warnings: current
			.filter( ( e ) => e.type === 'warning' )
			.flatMap( ( e ) => e.data.messages ?? [] ),
		progress: steps.length ? { completed: completed.size, total: steps.length } : null,
	};
}

export async function runOperation(
	input,
	directory,
	{ start = launch, pollMs = 1000, onStatus = () => {}, checkSite = verifySite, signal } = {}
) {
	const spec = normalizeSpec( input );
	if ( signal?.aborted ) throw new Error( 'Operation interrupted.' );
	if ( ! path.isAbsolute( directory ) )
		throw new Error( 'The operation directory must be absolute.' );
	fs.mkdirSync( path.dirname( directory ), { recursive: true } );
	fs.mkdirSync( directory, { mode: 0o700 } );
	const state = {
		v: 1,
		operationId: randomUUID(),
		pid: process.pid,
		phase: 'preflight',
		startedAt: now(),
		updatedAt: now(),
		localUrl: null,
		remoteUrl: null,
		sitePath: path.join(
			process.env.SITE_BUILD_STUDIO_ROOT ?? path.join( homedir(), 'Studio' ),
			spec.slug
		),
		project: path.join( directory, 'projects', spec.slug ),
		runId: null,
		progress: null,
		warnings: [],
		timings: {},
		checks: null,
		result: null,
	};
	const children = new Set();
	const env = {
		...process.env,
		SITE_BUILD_LLM: TRANSPORTS[ spec.harness ][ 0 ],
		SITE_BUILD_PROJECTS_DIR: path.join( directory, 'projects' ),
		IMAGE_PROVIDER: spec.images === 'harness' ? 'harness' : 'none',
		SITE_BUILD_IMAGE_BRIDGE_DIR: path.join( directory, 'images' ),
		SITE_BUILD_IMAGE_BRIDGE_MODEL: 'harness-image-tool',
	};
	const write = ( patch = {} ) => {
		if ( state.phase === 'interrupted' && patch.phase !== 'interrupted' )
			throw new Error( 'Operation interrupted.' );
		Object.assign( state, patch, { updatedAt: now() } );
		atomicJson( path.join( directory, 'status.json' ), state );
		onStatus( {
			...state,
			imageRequests: terminal.has( state.phase ) ? [] : pendingImages( directory ),
		} );
	};
	atomicJson( path.join( directory, 'request.json' ), spec );
	fs.writeFileSync( path.join( directory, 'prompt.txt' ), spec.prompt, { mode: 0o600 } );
	fs.mkdirSync( path.join( directory, 'bin' ) );
	const originalPath = process.env.PATH;
	const shim =
		'#!' +
		process.execPath +
		'\n' +
		"import {spawnSync} from 'node:child_process';\n" +
		'const [command,...base]=' +
		JSON.stringify( spec.studioCommand ) +
		';\n' +
		'const args=process.argv.slice(2); if(process.env.STUDIO_OPERATION_NATIVE_ONLY==="1" && args[0]==="create"){const i=args.indexOf("--runtime");if(i!==-1){if(args[i+1]!=="native")throw new Error("Only native PHP is supported by this Studio CLI.");args.splice(i,2);}}\n' +
		'const result=spawnSync(command,[...base,...args],{stdio:"inherit",env:{...process.env,PATH:' +
		JSON.stringify( originalPath ) +
		'}});\n' +
		'if(result.error) process.stderr.write(result.error.message+"\\n"); process.exit(result.status ?? 1);\n';
	fs.writeFileSync( path.join( directory, 'bin', 'studio' ), shim, { mode: 0o700 } );
	// The engine resolves "studio" from PATH; the shim pins the same CLI used for checks.
	env.PATH = path.join( directory, 'bin' ) + path.delimiter + originalPath;
	const begin = ( command, args, label ) => {
		if ( state.phase === 'interrupted' ) throw new Error( 'Operation interrupted.' );
		const started = performance.now();
		const child = start( command, args, {
			cwd: spec.engineHome,
			env,
			logFile: path.join( directory, label + '.log' ),
		} );
		children.add( child );
		child.done = child.done.then( ( result ) => {
			children.delete( child );
			state.timings[ label ] = Math.round( performance.now() - started );
			return result;
		} );
		return child;
	};
	const finish = async ( child ) => {
		const result = await child.done;
		if ( result.code !== 0 || result.stopped )
			throw new Error( 'Command failed (' + result.code + '): ' + result.stderr.slice( -1000 ) );
		return result.stdout;
	};
	const php = ( name, args, label ) =>
		begin( 'php', [ path.join( spec.engineHome, 'bin', name ), ...args ], label );
	const interrupt = () => {
		for ( const child of children ) child.stop();
	};
	const onSignal = () => {
		state.phase = 'interrupted';
		interrupt();
	};
	process.on( 'SIGINT', onSignal );
	process.on( 'SIGTERM', onSignal );
	signal?.addEventListener( 'abort', onSignal, { once: true } );
	write();
	try {
		if ( process.platform === 'win32' )
			throw new Error( 'This source-checkout prototype currently supports macOS/Linux.' );
		for ( const name of [ 'build.php', 'prepare-studio.php', 'serve.php' ] )
			if ( ! fs.existsSync( path.join( spec.engineHome, 'bin', name ) ) )
				throw new Error( 'Missing engine entry point: ' + name );
		const protocol = lastJson( await finish( php( 'build.php', [ '--protocol' ], 'protocol' ) ) );
		const required = [
			'events',
			'prompt-file',
			'projects-dir',
			'wordpress',
			'studio-prepare',
			...( spec.images === 'harness' ? [ 'harness-images' ] : [] ),
			...( spec.designFallback ? [ 'studio-design-fallback' ] : [] ),
		];
		for ( const capability of required )
			if ( ! protocol.capabilities?.includes( capability ) )
				throw new Error( 'Engine lacks capability: ' + capability );
		const [ transport, provider ] = TRANSPORTS[ spec.harness ];
		const probe = await php( 'build.php', [ '--transport', '--provider=' + provider ], 'transport' )
			.done;
		if (
			probe.code !== 0 ||
			probe.stopped ||
			! ( probe.stdout + probe.stderr ).includes( transport ) ||
			! /subscription/i.test( probe.stdout + probe.stderr )
		)
			throw new Error( 'Matching subscription transport was not confirmed.' );
		await finish(
			begin(
				spec.studioCommand[ 0 ],
				[ ...spec.studioCommand.slice( 1 ), 'list', '--format=json' ],
				'studio-preflight'
			)
		);
		const createHelp = await finish(
			begin(
				spec.studioCommand[ 0 ],
				[ ...spec.studioCommand.slice( 1 ), 'create', '--help' ],
				'studio-capabilities'
			)
		);
		env.STUDIO_OPERATION_NATIVE_ONLY = /--runtime\b/.test( createHelp ) ? '0' : '1';
		if ( spec.publish ) {
			const planned = lastJson(
				await finish(
					begin(
						spec.studioCommand[ 0 ],
						[
							...spec.studioCommand.slice( 1 ),
							'publish',
							'--check',
							'--path=' + state.sitePath,
							'--remote-site=' + spec.publish.remoteSite,
							'--visibility=' + ( spec.publish.visibility ?? 'preserve' ),
							'--output=' + path.join( directory, 'publication' ),
							'--operation-id=' + state.operationId,
						],
						'publication-plan'
					)
				)
			);
			if ( planned.phase !== 'planned' || ! planned.result?.remote?.url )
				throw new Error( 'Publication preflight did not return a plan.' );
			write( { remoteUrl: planned.result.remote.url, publication: planned.result } );
		}
		write( { phase: 'generating' } );
		const flags = spec.engineArguments.some( ( a ) =>
			/^--(?:dsl|blocks-first|pattern)(?:=|$)/.test( a )
		)
			? spec.engineArguments
			: [ '--dsl', '--dsl-mode=fast', ...spec.engineArguments ];
		const build = php(
			'build.php',
			[
				'--prompt-file=' + path.join( directory, 'prompt.txt' ),
				'--slug=' + spec.slug,
				'--provider=' + provider,
				'--no-serve',
				spec.singlePage ? '--single-page' : '--multi-page',
				...( spec.images === 'harness' ? [ '--with-images' ] : [] ),
				...( spec.designFallback ? [ '--studio-design-fallback=on' ] : [] ),
				...flags,
			],
			'generation'
		);
		let buildFinished = false;
		void build.done.then( () => {
			buildFinished = true;
		} );
		let prepare = null,
			previous = '';
		while ( ! buildFinished ) {
			if ( state.phase === 'interrupted' ) throw new Error( 'Operation interrupted.' );
			if ( ! prepare && fs.existsSync( path.join( state.project, 'meta.json' ) ) )
				prepare = php(
					'prepare-studio.php',
					[ spec.slug, '--name=' + spec.name, '--json' ],
					'preparation'
				);
			const summary = journalSummary( path.join( state.project, 'events.jsonl' ) );
			if ( prepare && ! state.localUrl && state.timings.preparation !== undefined ) {
				const receipt = lastJson( await finish( prepare ) );
				if ( receipt.prepared !== true || receipt.runner !== 'studio' )
					throw new Error( 'Studio preparation receipt was not confirmed.' );
				state.localUrl = receipt.url;
			}
			const next = JSON.stringify( [
				summary,
				pendingImages( directory ).map( ( r ) => [ r.id, r.claimed ] ),
				state.localUrl,
			] );
			if ( next !== previous ) {
				write( {
					runId: summary.runId,
					step: summary.step,
					progress: summary.progress,
					warnings: summary.warnings,
				} );
				previous = next;
			}
			await sleep( pollMs );
		}
		await finish( build );
		const summary = journalSummary( path.join( state.project, 'events.jsonl' ) );
		if ( ! summary.runId || ! summary.completed )
			throw new Error( 'Engine exited without an unbounded build.completed event.' );
		write( { runId: summary.runId, progress: summary.progress, warnings: summary.warnings } );
		if ( ! prepare )
			prepare = php(
				'prepare-studio.php',
				[ spec.slug, '--name=' + spec.name, '--json' ],
				'preparation'
			);
		const prepared = lastJson( await finish( prepare ) );
		if ( prepared.prepared !== true || prepared.runner !== 'studio' )
			throw new Error( 'Invalid Studio preparation receipt.' );
		write( { phase: 'importing', localUrl: prepared.url } );
		const served = lastJson(
			await finish( php( 'serve.php', [ spec.slug, '--runner=studio', '--json' ], 'import' ) )
		);
		if ( served.runner !== 'studio' || served.url !== prepared.url )
			throw new Error( 'Import did not retain the prepared Studio destination.' );
		if ( pendingImages( directory ).length ) throw new Error( 'Image commissions remain pending.' );
		const statsFile = path.join( state.project, 'build-stats.json' );
		if ( fs.existsSync( statsFile ) ) {
			const stats = read( statsFile );
			if (
				spec.images === 'harness' &&
				( ( stats.images?.failed_assets ?? 0 ) > 0 || ( stats.images?.placeholders ?? 0 ) > 0 )
			)
				throw new Error( 'Image failures or placeholders require review.' );
		}
		write( { phase: 'checking' } );
		const checks = await checkSite( { spec, state, env, begin, finish, directory } );
		write( {
			phase: spec.publish ? 'checked' : 'ready',
			checks,
			result: { kind: 'local-preview', url: served.url },
			finishedAt: now(),
		} );
		if ( spec.publish )
			await publishOperation( directory, spec.publish.remoteSite, {
				visibility: spec.publish.visibility ?? 'preserve',
				onStatus,
				start,
			} );
		return getStatus( directory );
	} catch ( error ) {
		interrupt();
		await Promise.allSettled( [ ...children ].map( ( child ) => child.done ) );
		if (
			spec.publish &&
			read( path.join( directory, 'status.json' ) ).phase.startsWith( 'publication_' )
		)
			throw error;
		write( {
			phase: state.phase === 'interrupted' ? 'interrupted' : 'failed',
			error: error.message,
			finishedAt: now(),
		} );
		throw error;
	} finally {
		process.off( 'SIGINT', onSignal );
		process.off( 'SIGTERM', onSignal );
		signal?.removeEventListener( 'abort', onSignal );
	}
}

export async function verifySite( { spec, state, begin, finish, directory } ) {
	const php =
		"echo wp_json_encode(array_map(function($p){return ['title'=>$p->post_title,'url'=>get_permalink($p->ID)];},get_posts(['post_type'=>'page','post_status'=>'publish','numberposts'=>-1])));";
	const output = await finish(
		begin(
			spec.studioCommand[ 0 ],
			[ ...spec.studioCommand.slice( 1 ), 'wp', 'eval', php, '--path=' + state.sitePath ],
			'pages'
		)
	);
	const pages = lastJson( output );
	if ( ! Array.isArray( pages ) || ! pages.length ) throw new Error( 'No published pages found.' );
	const responses = await Promise.all(
		pages.map( async ( page ) => {
			const url = new URL( page.url );
			if ( url.origin !== new URL( state.localUrl ).origin )
				throw new Error( 'A generated page points outside this local site.' );
			const response = await fetch( url, { signal: AbortSignal.timeout( 30000 ) } );
			const html = await response.text();
			if ( ! response.ok || /(?:Fatal error|Parse error):/i.test( html ) )
				throw new Error( 'Page failed rendering: ' + url );
			return { title: page.title, url: String( url ), status: response.status };
		} )
	);
	const { chromium } = await import( 'playwright' );
	const browser = await chromium.launch( { headless: true } );
	const screenshots = [];
	try {
		await Promise.all(
			[ 'light', 'dark' ].flatMap( ( colorScheme ) =>
				[
					{ name: 'desktop', width: 1440, height: 1000 },
					{ name: 'mobile', width: 390, height: 844 },
				].map( async ( viewport ) => {
					const context = await browser.newContext( {
						viewport: { width: viewport.width, height: viewport.height },
						colorScheme,
					} );
					try {
						const page = await context.newPage();
						for ( const [ index, entry ] of responses.entries() ) {
							await page.goto( entry.url, { waitUntil: 'load', timeout: 30000 } );
							const health = await page.evaluate( async () => {
								const images = [ ...document.images ];
								for ( const image of images ) image.loading = 'eager';
								await Promise.all( images.map( ( image ) => image.decode().catch( () => {} ) ) );
								return {
									overflow: document.documentElement.scrollWidth > innerWidth + 1,
									brokenImages: images
										.filter( ( image ) => ! image.naturalWidth )
										.map( ( image ) => image.currentSrc ),
								};
							} );
							if ( health.overflow || health.brokenImages.length )
								throw new Error(
									'Layout/image check failed: ' +
										entry.url +
										' (' +
										viewport.name +
										', ' +
										colorScheme +
										')'
								);
							const file = path.join(
								directory,
								'screenshots',
								index + '-' + viewport.name + '-' + colorScheme + '.png'
							);
							fs.mkdirSync( path.dirname( file ), { recursive: true } );
							await page.screenshot( { path: file, fullPage: true } );
							screenshots.push( { url: entry.url, viewport: viewport.name, colorScheme, file } );
						}
					} finally {
						await context.close();
					}
				} )
			)
		);
	} finally {
		await browser.close();
	}
	return { pages: responses, screenshots, visualReview: 'pending', formDelivery: 'not-tested' };
}

export function validateRemoteSite( remoteSite ) {
	if (
		typeof remoteSite !== 'string' ||
		remoteSite !== remoteSite.trim() ||
		! /^(?:[0-9]+|https:\/\/[a-z0-9.-]+\/?)$/.test( remoteSite )
	)
		throw new Error( 'Name the exact remote site ID or HTTPS URL.' );
	return remoteSite;
}

export async function publishOperation(
	directory,
	remoteSite,
	{
		visibility = 'preserve',
		verifyOnly = false,
		newAttempt = false,
		onStatus = () => {},
		start = launch,
	} = {}
) {
	const state = getStatus( directory ),
		spec = read( path.join( directory, 'request.json' ) );
	if ( newAttempt && ( state.phase !== 'published' || ! state.publication?.verification ) )
		throw new Error( 'Verify the previous publication before explicitly republishing.' );
	if ( ! verifyOnly && ! newAttempt && ! [ 'ready', 'checked' ].includes( state.phase ) )
		throw new Error( 'Only a checked local build can be published.' );
	if ( verifyOnly && state.ownerAlive && state.phase.startsWith( 'publication_' ) )
		throw new Error( 'The publication is still running.' );
	validateRemoteSite( remoteSite );
	const publicationDirectory = newAttempt
		? path.join( directory, 'publication-' + randomUUID() )
		: state.publicationDirectory ?? path.join( directory, 'publication' );
	if ( ! [ 'preserve', 'private' ].includes( visibility ) )
		throw new Error( 'Choose preserve or private visibility.' );
	const write = ( patch ) => {
		Object.assign( state, patch, { pid: process.pid, updatedAt: now() } );
		atomicJson( path.join( directory, 'status.json' ), state );
		onStatus( { ...state, imageRequests: [] } );
	};
	let completed = null,
		failed = null,
		child;
	const cancel = () => {
		write( { cancelRequested: true } );
		child?.requestCancel?.();
	};
	process.on( 'SIGINT', cancel );
	process.on( 'SIGTERM', cancel );
	try {
		write( {
			phase: 'publication_preflight',
			remoteSite,
			publicationDirectory,
			publication: null,
			result: null,
			error: null,
		} );
		child = start(
			spec.studioCommand[ 0 ],
			[
				...spec.studioCommand.slice( 1 ),
				'publish',
				'--path=' + state.sitePath,
				'--remote-site=' + remoteSite,
				'--visibility=' + visibility,
				'--output=' + publicationDirectory,
				'--operation-id=' + state.operationId,
				...( verifyOnly ? [ '--verify-only' ] : [] ),
			],
			{
				logFile: path.join( directory, 'publish.log' ),
				timeoutMs: 0,
				onStdoutLine: ( line ) => {
					let event;
					try {
						event = JSON.parse( line );
					} catch {
						return;
					}
					if ( event.type === 'publication.progress' ) {
						write( {
							phase: 'publication_' + event.phase,
							remoteUrl: event.remoteUrl,
							publicationProgress: event.progress ?? null,
						} );
					} else if ( event.type === 'publication.completed' ) completed = event.result;
					else if ( event.type === 'publication.failed' ) failed = event.result;
				},
			}
		);
		const result = await child.done;
		if (
			result.code !== 0 ||
			result.stopped ||
			result.observerError ||
			! completed ||
			! [ 'published', 'verified' ].includes( completed.phase )
		)
			throw new Error(
				result.observerError ??
					'Publication did not complete verification; inspect the receipt before any retry.'
			);
		write( {
			phase: 'published',
			error: null,
			remoteUrl: completed.remote.url,
			publication: completed,
			warnings: state.warnings.filter(
				( w ) => ! w.startsWith( 'Transfer completed; remote privacy' )
			),
			result: {
				kind: 'verified-publication',
				url: completed.remote.url,
				visibility: completed.verification.visibility,
				verification: completed.verification,
			},
			finishedAt: now(),
		} );
		return getStatus( directory );
	} catch ( error ) {
		write( {
			phase: 'publication_failed',
			publication: failed,
			result: {
				kind: 'publication-failure',
				transferCompleted: failed?.transferCompleted ?? false,
				verification: null,
			},
			error: failed?.error ?? error.message,
		} );
		throw error;
	} finally {
		process.off( 'SIGINT', cancel );
		process.off( 'SIGTERM', cancel );
	}
}

export async function main( argv = process.argv.slice( 2 ) ) {
	const [ command, directory, ...args ] = argv;
	if ( command === 'run' ) {
		if ( ! directory || args.length !== 1 )
			throw new Error(
				'Usage: build-operation.mjs run <absolute-operation-directory> <request.json>'
			);
		await runOperation( read( path.resolve( args[ 0 ] ) ), directory, {
			onStatus: ( status ) => process.stdout.write( JSON.stringify( status ) + '\n' ),
		} );
	} else if ( command === 'status' ) {
		process.stdout.write( JSON.stringify( getStatus( directory ), null, 2 ) + '\n' );
	} else if ( command === 'image-claim' ) {
		process.stdout.write( JSON.stringify( claimImage( directory, args[ 0 ] ), null, 2 ) + '\n' );
	} else if ( command === 'image-complete' || command === 'image-fail' ) {
		const state = getStatus( directory );
		if ( terminal.has( state.phase ) || state.interrupted )
			throw new Error( 'The operation is not accepting images.' );
		const result = await launch( process.execPath, [
			HELPER,
			command === 'image-complete' ? 'complete' : 'fail',
			path.join( directory, 'images' ),
			...args,
		] ).done;
		if ( result.code !== 0 ) throw new Error( result.stderr );
		process.stdout.write( result.stdout );
	} else if (
		command === 'publish' ||
		command === 'verify-publication' ||
		command === 'republish'
	) {
		if ( args.length !== 1 && ! ( command === 'verify-publication' && args.length === 0 ) )
			throw new Error(
				'Usage: build-operation.mjs publish|republish|verify-publication <directory> <remote-site-id-or-url>'
			);
		const saved = getStatus( directory );
		const request = read( path.join( directory, 'request.json' ) );
		await publishOperation(
			directory,
			args[ 0 ] ?? request.publish?.remoteSite ?? saved.remoteSite,
			{
				visibility: request.publish?.visibility ?? 'preserve',
				verifyOnly: command === 'verify-publication',
				newAttempt: command === 'republish',
				onStatus: ( status ) => process.stdout.write( JSON.stringify( status ) + '\n' ),
			}
		);
	} else
		throw new Error(
			'PROTOTYPE usage: build-operation.mjs run <directory> <request.json> | status <directory> | image-complete <directory> <id> <png> | image-fail <directory> <id> <reason> | publish <directory> <remote-site>'
		);
}
if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {
	main().catch( ( error ) => {
		process.stderr.write( error.message + '\n' );
		process.exitCode = 1;
	} );
}
