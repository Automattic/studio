// The plugin's MCP server: it runs `studio mcp` and relays every message to it.
// Without a Studio CLI, it stands in for it while one installs in the background,
// so the host gets a server (and the WordPress page) right away. A CLI it
// installed is kept up to date: new versions are installed aside and swapped in
// when Studio is idle.
// No dependencies: it runs with any Node.js before Studio is on the machine.
//
// stdout carries the MCP messages: anything else must go to stderr.
import { execFile, spawn } from 'node:child_process';
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const INSTALLER_URL = process.env.STUDIO_INSTALLER_URL || 'https://wordpress.studio/install.sh';
const UPDATES_URL =
	process.env.STUDIO_UPDATES_URL || 'https://public-api.wordpress.com/wpcom/v2/studio-app/updates';
const STUDIO_HOME = process.env.STUDIO_CLI_HOME || path.join( homedir(), '.studio' );
const STUDIO_BIN = path.join( STUDIO_HOME, 'bin', 'studio' );
const UPDATE_STATE = path.join( STUDIO_HOME, 'plugin-update.json' );
const UPDATE_STAGING = path.join( STUDIO_HOME, '.plugin-update' );
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_UPDATE_CHECK_MS = 30_000;
const IDLE_RETRY_MS = 60_000;
const SETUP_URI = 'ui://wordpress-studio/setup.html';
const LOG_LINES = 12;

const WORDPRESS_LOGO_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M 22 12 C 22 6.49 17.51 2 12 2 C 6.48 2 2 6.49 2 12 C 2 17.52 6.48 22 12 22 C 17.51 22 22 17.52 22 12 M 9.78 17.37 L 6.37 8.22 C 6.92 8.2 7.54 8.14 7.54 8.14 C 8.04 8.08 7.98 7.01 7.48 7.03 C 7.48 7.03 6.03 7.14 5.11 7.14 C 4.93 7.14 4.74 7.14 4.53 7.13 C 6.12 4.69 8.87 3.11 12 3.11 C 14.33 3.11 16.45 3.98 18.05 5.45 C 17.37 5.34 16.4 5.84 16.4 7.03 C 16.4 7.77 16.85 8.39 17.3 9.13 C 17.65 9.74 17.85 10.49 17.85 11.59 C 17.85 13.08 16.45 16.59 16.45 16.59 L 13.42 8.22 C 13.96 8.2 14.24 8.05 14.24 8.05 C 14.74 8 14.68 6.8 14.18 6.83 C 14.18 6.83 12.74 6.95 11.8 6.95 C 10.93 6.95 9.47 6.83 9.47 6.83 C 8.97 6.8 8.91 8.03 9.41 8.05 L 10.33 8.13 L 11.59 11.54 L 9.78 17.37 M 19.41 12 C 19.65 11.36 20.15 10.13 19.84 7.75 C 20.54 9.04 20.89 10.46 20.89 12 C 20.89 15.29 19.16 18.24 16.49 19.78 C 17.46 17.19 18.43 14.58 19.41 12 M 8.1 20.09 C 5.12 18.65 3.11 15.53 3.11 12 C 3.11 10.7 3.34 9.52 3.83 8.41 C 5.25 12.3 6.67 16.2 8.1 20.09 M 12.13 13.46 L 14.71 20.44 C 13.85 20.73 12.95 20.89 12 20.89 C 11.21 20.89 10.43 20.78 9.71 20.56 C 10.52 18.18 11.33 15.82 12.13 13.46 L 12.13 13.46" /></svg>';

const setup = {
	state: 'installing',
	step: 'Starting',
	startedAt: Date.now(),
	log: [],
	downloadedBytes: 0,
};
let studio = null; // how to run the Studio CLI: { command, args, updates }
let child = null; // the running `studio mcp`
let relaying = false; // host messages go straight to `studio mcp`
let swapping = false; // `studio mcp` is restarting on a new version
let hostInitialize = null; // the host's initialize params, replayed on restarts
let libraryHtml = null;
const queued = []; // host messages that arrive while `studio mcp` restarts
const inFlight = new Set(); // host requests `studio mcp` has not answered yet

const write = ( message ) => process.stdout.write( JSON.stringify( message ) + '\n' );
const reply = ( id, result ) => write( { jsonrpc: '2.0', id, result } );
const fail = ( id, message ) => write( { jsonrpc: '2.0', id, error: { code: -32601, message } } );
const log = ( line ) => {
	process.stderr.write( `[wordpress-studio setup] ${ line }\n` );
	setup.log = [ ...setup.log, line ].slice( -LOG_LINES );
};

const textResult = ( text, structuredContent ) => ( {
	content: [ { type: 'text', text } ],
	...( structuredContent ? { structuredContent } : {} ),
} );

const setupStatus = () => ( {
	view: 'setup',
	state: setup.state,
	step: setup.step,
	elapsedSeconds: Math.round( ( Date.now() - setup.startedAt ) / 1000 ),
	downloadedMegabytes: Math.round( setup.downloadedBytes / 1e6 ),
	log: setup.log,
} );

const describeStatus = () =>
	setup.state === 'ready'
		? 'WordPress Studio is installed and ready.'
		: setup.state === 'failed'
		? `WordPress Studio could not be installed: ${ setup.log.at( -1 ) ?? 'unknown error' }`
		: `WordPress Studio is still installing (${ setup.step.toLowerCase() }). Its tools appear when it is done; tell the user it takes a few minutes the first time.`;

const ICON = {
	src: `data:image/svg+xml;base64,${ Buffer.from( WORDPRESS_LOGO_SVG ).toString( 'base64' ) }`,
	mimeType: 'image/svg+xml',
	sizes: [ 'any' ],
};

const SETUP_TOOLS = [
	{
		name: 'open_wordpress',
		title: 'WordPress',
		description:
			"Opens the WordPress library. While WordPress Studio installs, it shows the installation's progress.",
		inputSchema: { type: 'object', properties: {} },
		icons: [ ICON ],
		_meta: {
			ui: { resourceUri: SETUP_URI, visibility: [ 'app' ] },
			'openai/ui': { entrypoints: [ { type: 'global' }, { type: 'thread' } ] },
		},
	},
	{
		name: 'studio_setup_status',
		description:
			'Reports whether WordPress Studio has finished installing. Call it before any WordPress Studio work while setup is running.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true },
	},
	{
		name: 'studio_setup_retry',
		description: 'Retries a failed WordPress Studio installation. Only the setup page calls it.',
		inputSchema: { type: 'object', properties: {} },
		_meta: { ui: { resourceUri: SETUP_URI, visibility: [ 'app' ] } },
	},
	{
		name: 'studio_library_page',
		description:
			'Returns the WordPress library page once Studio is installed. Only the setup page calls it.',
		inputSchema: { type: 'object', properties: {} },
		_meta: { ui: { resourceUri: SETUP_URI, visibility: [ 'app' ] } },
	},
];

const SETUP_META = {
	ui: { prefersBorder: true },
	'openai/ui': {
		preferredDisplayMode: 'fullscreen',
		availableDisplayModes: [ 'inline', 'fullscreen' ],
	},
};

// The installer's archive lands in a staging folder; its size is the download's progress.
function watchDownload() {
	const timer = setInterval( () => {
		if ( setup.state !== 'installing' ) {
			clearInterval( timer );
			return;
		}
		try {
			for ( const entry of readdirSync( STUDIO_HOME ) ) {
				if ( ! entry.startsWith( '.studio-install.' ) ) continue;
				const staging = path.join( STUDIO_HOME, entry );
				for ( const file of readdirSync( staging ) ) {
					if ( file.endsWith( '.tgz' ) ) {
						setup.downloadedBytes = statSync( path.join( staging, file ) ).size;
					}
				}
			}
		} catch {
			// The folder comes and goes with the installer.
		}
	}, 500 );
}

function install() {
	Object.assign( setup, {
		state: 'installing',
		step: 'Downloading',
		startedAt: Date.now(),
		log: [],
		downloadedBytes: 0,
	} );
	log( `Installing the Studio CLI from ${ INSTALLER_URL }` );
	watchDownload();
	const installer = spawn( '/bin/sh', [ '-c', 'curl -fsSL "$0" | sh', INSTALLER_URL ], {
		env: process.env,
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	const onLine = ( line ) => {
		if ( ! line.trim() ) return;
		log( line );
		if ( line.startsWith( 'Installing to' ) ) setup.step = 'Unpacking';
		if ( line.startsWith( 'Stopping running' ) ) setup.step = 'Stopping old sites';
	};
	readline.createInterface( { input: installer.stdout } ).on( 'line', onLine );
	readline.createInterface( { input: installer.stderr } ).on( 'line', onLine );
	installer.on( 'exit', ( code ) => {
		if ( code === 0 && existsSync( STUDIO_BIN ) ) {
			setup.step = 'Starting';
			studio = { command: STUDIO_BIN, args: [], updates: true };
			startStudio( { afterSetup: true } );
		} else {
			setup.state = 'failed';
			log( `The installer stopped (exit code ${ code }).` );
		}
	} );
}

const isExecutable = ( file ) => {
	try {
		accessSync( file, constants.X_OK );
		return statSync( file ).isFile();
	} catch {
		return false;
	}
};
const realpath = ( file ) => {
	try {
		return realpathSync( file );
	} catch {
		return file;
	}
};

// A development build (STUDIO_CLI_BIN), the `studio` command, then the known
// install locations. Only the CLI this plugin installs (in ~/.studio) is
// updated here: the desktop app and npm update theirs.
function findStudio() {
	if ( process.env.STUDIO_CLI_BIN ) {
		return { command: process.execPath, args: [ process.env.STUDIO_CLI_BIN ], updates: false };
	}
	const candidates = [
		...( process.env.PATH ?? '' )
			.split( path.delimiter )
			.map( ( dir ) => path.join( dir, 'studio' ) ),
		STUDIO_BIN,
		path.join( homedir(), '.local', 'bin', 'studio' ),
		'/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh',
		'/usr/lib/studio/resources/bin/studio-cli.sh',
	];
	const command = candidates.find( isExecutable );
	return command
		? { command, args: [], updates: realpath( command ) === realpath( STUDIO_BIN ) }
		: null;
}

const pending = new Map(); // our own requests to `studio mcp`, by id

function requestChild( method, params ) {
	const id = `setup-${ pending.size + 1 }-${ Date.now() }`;
	return new Promise( ( resolve, reject ) => {
		pending.set( id, { resolve, reject } );
		child.stdin.write( JSON.stringify( { jsonrpc: '2.0', id, method, params } ) + '\n' );
	} );
}

function forward( line, message ) {
	if ( message.id !== undefined && message.method ) {
		inFlight.add( message.id );
	}
	child.stdin.write( line + '\n' );
}

// Starts `studio mcp`. On a plain start the host's own messages, initialize
// included, go straight to it. After setup or an update, the host has already
// initialized, so its handshake is replayed before relaying resumes.
function startStudio( { afterSetup = false, afterUpdate = false } = {} ) {
	child = spawn( studio.command, [ ...studio.args, 'mcp' ], {
		env: process.env,
		stdio: [ 'pipe', 'pipe', 'inherit' ],
	} );
	child.on( 'exit', ( code ) => {
		if ( swapping ) {
			return;
		}
		log( `studio mcp exited (code ${ code }).` );
		process.exit( code ?? 1 );
	} );
	readline.createInterface( { input: child.stdout } ).on( 'line', ( line ) => {
		let message;
		try {
			message = JSON.parse( line );
		} catch {
			return;
		}
		const own = pending.get( message.id );
		if ( own ) {
			pending.delete( message.id );
			if ( message.error ) {
				own.reject( new Error( message.error.message ) );
			} else {
				own.resolve( message.result );
			}
			return;
		}
		if ( message.id !== undefined && ! message.method ) {
			inFlight.delete( message.id );
		}
		process.stdout.write( line + '\n' );
	} );
	if ( ! afterSetup && ! afterUpdate ) {
		relaying = true;
		return;
	}
	requestChild(
		'initialize',
		hostInitialize ?? {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'unknown', version: '0' },
		}
	)
		.then( async () => {
			child.stdin.write(
				JSON.stringify( { jsonrpc: '2.0', method: 'notifications/initialized' } ) + '\n'
			);
			if ( afterSetup ) {
				const { tools } = await requestChild( 'tools/list', {} );
				const uri = tools.find( ( tool ) => tool.name === 'open_wordpress' )?._meta?.ui
					?.resourceUri;
				if ( uri ) {
					const { contents } = await requestChild( 'resources/read', { uri } );
					libraryHtml = contents?.[ 0 ]?.text ?? null;
				}
				setup.state = 'ready';
				setup.step = 'Ready';
				log( 'WordPress Studio is ready.' );
				scheduleUpdateCheck( FIRST_UPDATE_CHECK_MS );
			}
			relaying = true;
			swapping = false;
			queued.splice( 0 ).forEach( ( entry ) => forward( entry.line, entry.message ) );
			write( { jsonrpc: '2.0', method: 'notifications/tools/list_changed' } );
			write( { jsonrpc: '2.0', method: 'notifications/resources/list_changed' } );
		} )
		.catch( ( error ) => {
			setup.state = 'failed';
			log( `studio mcp did not start: ${ error.message }` );
		} );
}

// --- Updates ------------------------------------------------------------------

const readUpdateState = () => {
	try {
		return JSON.parse( readFileSync( UPDATE_STATE, 'utf8' ) );
	} catch {
		return {};
	}
};
const writeUpdateState = ( state ) => {
	try {
		writeFileSync( UPDATE_STATE, JSON.stringify( { ...readUpdateState(), ...state }, null, '\t' ) );
	} catch {
		// Next start checks again.
	}
};

const runStudio = ( args ) =>
	new Promise( ( resolve ) => {
		execFile( studio.command, [ ...studio.args, ...args ], { timeout: 60_000 }, ( error, stdout ) =>
			resolve( error ? null : stdout.trim() )
		);
	} );

// The same endpoint and product the CLI's own update notifier checks: 204 when
// the running version is current, otherwise the latest version.
async function fetchLatestVersion( current ) {
	const url = new URL( UPDATES_URL );
	url.searchParams.set( 'product', 'wordpress-com-studio-cli' );
	url.searchParams.set( 'platform', process.platform );
	url.searchParams.set( 'studioArch', process.arch );
	url.searchParams.set( 'version', current );
	const response = await fetch( url, { signal: AbortSignal.timeout( 10_000 ) } );
	if ( response.status === 204 || ! response.ok ) {
		return null;
	}
	const { version } = await response.json();
	return typeof version === 'string' && version !== current ? version : null;
}

// Installs a version aside: the official installer, pointed at a staging home
// so it neither stops the running sites nor touches the user's PATH.
function stageUpdate( version ) {
	rmSync( UPDATE_STAGING, { recursive: true, force: true } );
	mkdirSync( path.join( UPDATE_STAGING, 'home' ), { recursive: true } );
	return new Promise( ( resolve ) => {
		const installer = spawn( '/bin/sh', [ '-c', 'curl -fsSL "$0" | sh', INSTALLER_URL ], {
			env: {
				...process.env,
				HOME: path.join( UPDATE_STAGING, 'home' ),
				STUDIO_CLI_HOME: path.join( UPDATE_STAGING, 'studio' ),
				STUDIO_CLI_VERSION: `v${ version }`,
			},
			stdio: [ 'ignore', 'ignore', 'ignore' ],
		} );
		installer.on( 'exit', ( code ) =>
			resolve( code === 0 && existsSync( path.join( UPDATE_STAGING, 'studio', 'bin', 'studio' ) ) )
		);
	} );
}

async function sitesRunning() {
	const output = await runStudio( [ 'site', 'list', '--format', 'json' ] );
	try {
		return JSON.parse( output ).some( ( site ) => site.running );
	} catch {
		return true;
	}
}

// Swaps the staged version in once no request is waiting on `studio mcp` and no
// site runs (their servers run from the files being replaced).
async function swapWhenIdle( version ) {
	if ( inFlight.size > 0 || swapping || ( await sitesRunning() ) || inFlight.size > 0 ) {
		setTimeout( () => void swapWhenIdle( version ), IDLE_RETRY_MS );
		return;
	}
	swapping = true;
	relaying = false;
	const previous = child;
	const stopped = new Promise( ( resolve ) => previous.once( 'exit', resolve ) );
	previous.stdin.end();
	const forceStop = setTimeout( () => previous.kill(), 5000 );
	await stopped;
	clearTimeout( forceStop );
	for ( const dir of [ 'bin', 'cli' ] ) {
		rmSync( path.join( STUDIO_HOME, dir ), { recursive: true, force: true } );
		renameSync( path.join( UPDATE_STAGING, 'studio', dir ), path.join( STUDIO_HOME, dir ) );
	}
	rmSync( UPDATE_STAGING, { recursive: true, force: true } );
	writeUpdateState( { staged: null, updatedTo: version, updatedAt: Date.now() } );
	log( `Updated the Studio CLI to ${ version }.` );
	startStudio( { afterUpdate: true } );
	scheduleUpdateCheck( UPDATE_CHECK_INTERVAL_MS );
}

async function checkForUpdate() {
	const state = readUpdateState();
	if ( state.staged && existsSync( path.join( UPDATE_STAGING, 'studio', 'bin', 'studio' ) ) ) {
		void swapWhenIdle( state.staged );
		return;
	}
	const sinceLastCheck = Date.now() - ( state.lastChecked ?? 0 );
	if ( sinceLastCheck < UPDATE_CHECK_INTERVAL_MS ) {
		scheduleUpdateCheck( UPDATE_CHECK_INTERVAL_MS - sinceLastCheck );
		return;
	}
	try {
		const current = await runStudio( [ '--version' ] );
		const latest = current ? await fetchLatestVersion( current ) : null;
		writeUpdateState( { lastChecked: Date.now() } );
		if ( latest && ( await stageUpdate( latest ) ) ) {
			writeUpdateState( { staged: latest } );
			log( `Studio CLI ${ latest } is ready to install.` );
			void swapWhenIdle( latest );
			return;
		}
	} catch ( error ) {
		log( `Update check failed: ${ error.message }` );
	}
	scheduleUpdateCheck( UPDATE_CHECK_INTERVAL_MS );
}

function scheduleUpdateCheck( delay ) {
	if ( studio?.updates ) {
		setTimeout( () => void checkForUpdate(), delay ).unref();
	}
}

// Requests the setup server answers itself, before and after Studio is ready.
function answerSetup( message ) {
	const { id, method, params } = message;
	if ( method === 'tools/call' && params?.name === 'studio_setup_status' ) {
		reply( id, textResult( describeStatus(), setupStatus() ) );
		return true;
	}
	if ( method === 'tools/call' && params?.name === 'studio_setup_retry' ) {
		if ( setup.state === 'failed' ) install();
		reply( id, textResult( describeStatus(), setupStatus() ) );
		return true;
	}
	if ( method === 'tools/call' && params?.name === 'studio_library_page' ) {
		reply(
			id,
			textResult( libraryHtml ? 'Library page ready.' : 'Not ready.', { html: libraryHtml } )
		);
		return true;
	}
	if ( method === 'resources/read' && params?.uri === SETUP_URI ) {
		reply( id, {
			contents: [
				{
					uri: SETUP_URI,
					mimeType: 'text/html;profile=mcp-app',
					text: SETUP_HTML,
					_meta: SETUP_META,
				},
			],
		} );
		return true;
	}
	return false;
}

function handleWhileInstalling( message ) {
	const { id, method, params } = message;
	if ( id === undefined ) return; // notifications
	switch ( method ) {
		case 'initialize':
			reply( id, {
				protocolVersion: params?.protocolVersion ?? '2025-06-18',
				capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
				serverInfo: { name: 'wordpress-studio', version: '1.0.0' },
				instructions:
					'WordPress Studio is installing on this computer. Until it is done, call studio_setup_status before any WordPress task and tell the user it takes a few minutes the first time.',
			} );
			return;
		case 'ping':
			reply( id, {} );
			return;
		case 'tools/list':
			reply( id, { tools: SETUP_TOOLS } );
			return;
		case 'resources/list':
			reply( id, {
				resources: [
					{
						uri: SETUP_URI,
						name: 'WordPress Studio setup',
						mimeType: 'text/html;profile=mcp-app',
						_meta: SETUP_META,
					},
				],
			} );
			return;
		case 'resources/templates/list':
			reply( id, { resourceTemplates: [] } );
			return;
		case 'prompts/list':
			reply( id, { prompts: [] } );
			return;
		case 'tools/call':
			if ( params?.name === 'open_wordpress' ) {
				reply( id, textResult( describeStatus(), setupStatus() ) );
				return;
			}
			reply( id, { isError: true, content: [ { type: 'text', text: describeStatus() } ] } );
			return;
		default:
			fail( id, `${ method } is not available while WordPress Studio installs.` );
	}
}

readline.createInterface( { input: process.stdin } ).on( 'line', ( line ) => {
	let message;
	try {
		message = JSON.parse( line );
	} catch {
		return;
	}
	if ( message.method === 'initialize' ) {
		hostInitialize = message.params;
	}
	if ( message.id !== undefined && answerSetup( message ) ) return;
	if ( relaying ) {
		forward( line, message );
		return;
	}
	if ( swapping ) {
		queued.push( { line, message } );
		return;
	}
	handleWhileInstalling( message );
} );
process.stdin.on( 'end', () => {
	child?.kill();
	process.exit( 0 );
} );

const SETUP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WordPress</title>
<style>
	:root {
		color-scheme: light dark;
		--page: light-dark(#f6f7f7, #1e1e1e);
		--card: light-dark(#ffffff, #2c2c2c);
		--text: light-dark(#1e1e1e, #f0f0f0);
		--muted: light-dark(#757575, #a7aaad);
		--accent: light-dark(#3858e9, #7a92ff);
		--tint: light-dark(rgb(117 117 117 / 0.12), rgb(240 240 240 / 0.1));
		--danger: light-dark(#cc1818, #f86368);
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, sans-serif;
	}
	:root[data-theme="light"] { color-scheme: light; }
	:root[data-theme="dark"] { color-scheme: dark; }
	html, body { margin: 0; background: transparent; color: var(--text); font-size: 14px; line-height: 1.5; }
	:root[data-display-mode="fullscreen"], :root[data-display-mode="fullscreen"] body { background: var(--page); min-height: 100%; }
	main { display: grid; place-items: center; min-height: 320px; padding: 32px 16px; box-sizing: border-box; }
	:root[data-display-mode="fullscreen"] main { min-height: 100dvh; }
	.card { width: 100%; max-width: 460px; display: grid; gap: 14px; padding: 28px; border-radius: 14px; background: var(--card); box-shadow: 0 2px 16px light-dark(rgb(0 0 0 / 0.06), rgb(0 0 0 / 0.4)); }
	.card svg { width: 36px; height: 36px; }
	h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
	p { margin: 0; color: var(--muted); }
	.bar { position: relative; height: 6px; border-radius: 999px; background: var(--tint); overflow: hidden; }
	.bar > span { position: absolute; inset: 0 auto 0 0; width: 35%; border-radius: inherit; background: var(--accent); animation: slide 1.4s ease-in-out infinite; }
	.done .bar > span { width: 100%; animation: none; }
	.failed .bar > span { background: var(--danger); width: 100%; animation: none; }
	@keyframes slide { 0% { left: -35%; } 100% { left: 100%; } }
	@media (prefers-reduced-motion: reduce) { .bar > span { animation: none; width: 60%; } }
	.meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
	details summary { color: var(--muted); font-size: 12px; cursor: pointer; }
	pre { margin: 8px 0 0; max-height: 160px; overflow: auto; padding: 10px; border-radius: 8px; background: var(--tint); font-size: 11px; white-space: pre-wrap; }
	button { justify-self: start; min-height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--accent); color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
	[hidden] { display: none !important; }
</style>
</head>
<body>
<main>
	<section class="card" id="card" aria-live="polite">
		${ WORDPRESS_LOGO_SVG }
		<h1 id="title">Setting up WordPress Studio</h1>
		<p id="copy">Installing Studio on this computer so you can build and manage WordPress sites from here. This takes a few minutes the first time.</p>
		<div class="bar"><span></span></div>
		<div class="meta"><span id="step">Starting</span><span id="numbers"></span></div>
		<button id="retry" type="button" hidden>Try again</button>
		<details><summary>Details</summary><pre id="log"></pre></details>
	</section>
</main>
<script>
(() => {
	const root = document.documentElement;
	const pending = new Map();
	let id = 0;
	let switching = false;
	const send = (message) => window.parent.postMessage(message, "*");
	const request = (method, params) => new Promise((resolve, reject) => {
		const requestId = ++id;
		pending.set(requestId, { resolve, reject });
		send({ jsonrpc: "2.0", id: requestId, method, params });
		setTimeout(() => { if (pending.delete(requestId)) reject(new Error("timeout")); }, 30000);
	});
	// Some hosts (Codex) pass tool results wrapped as JSON text.
	const unwrap = (value) => {
		if (value && value.structuredContent) return value;
		for (const block of (value && value.content) || []) {
			if (block.type === "text") { try { const inner = JSON.parse(block.text); if (inner && typeof inner === "object") return unwrap(inner); } catch {} }
		}
		return value || {};
	};
	const applyContext = (context) => {
		if (!context) return;
		if (context.theme === "light" || context.theme === "dark") root.dataset.theme = context.theme;
		if (context.displayMode) root.dataset.displayMode = context.displayMode;
	};
	const resize = () => send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: Math.ceil(root.getBoundingClientRect().height) } });
	const render = (status) => {
		const card = document.getElementById("card");
		card.classList.toggle("done", status.state === "ready");
		card.classList.toggle("failed", status.state === "failed");
		document.getElementById("title").textContent = status.state === "ready" ? "WordPress Studio is ready" : status.state === "failed" ? "Setup did not finish" : "Setting up WordPress Studio";
		document.getElementById("copy").textContent = status.state === "ready" ? "Opening your sites…" : status.state === "failed" ? "The Studio installation stopped. Check your connection and try again." : "Installing Studio on this computer so you can build and manage WordPress sites from here. This takes a few minutes the first time.";
		document.getElementById("step").textContent = status.step;
		const minutes = Math.floor(status.elapsedSeconds / 60), seconds = String(status.elapsedSeconds % 60).padStart(2, "0");
		document.getElementById("numbers").textContent = (status.downloadedMegabytes ? status.downloadedMegabytes + " MB · " : "") + minutes + ":" + seconds;
		document.getElementById("retry").hidden = status.state !== "failed";
		document.getElementById("log").textContent = (status.log || []).join("\\n");
		resize();
	};
	// Once Studio is ready, this page turns into the library page in place.
	const openLibrary = async () => {
		if (switching) return;
		switching = true;
		try {
			const page = unwrap(await request("tools/call", { name: "studio_library_page", arguments: {} }));
			const html = page.structuredContent && page.structuredContent.html;
			if (!html) throw new Error("no page");
			document.open(); document.write(html); document.close();
		} catch {
			switching = false;
			document.getElementById("copy").textContent = "Studio is installed. Reopen WordPress from the sidebar to see your sites.";
		}
	};
	const poll = async () => {
		try {
			const status = unwrap(await request("tools/call", { name: "studio_setup_status", arguments: {} })).structuredContent;
			if (status) { render(status); if (status.state === "ready") { openLibrary(); return; } }
		} catch {}
		setTimeout(poll, 1500);
	};
	window.addEventListener("message", (event) => {
		if (event.source !== window.parent) return;
		const message = event.data || {};
		if (message.id !== undefined && pending.has(message.id)) {
			const entry = pending.get(message.id); pending.delete(message.id);
			message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
			return;
		}
		if (message.method === "ui/notifications/host-context-changed") applyContext(message.params);
		if (message.id !== undefined && message.method) send({ jsonrpc: "2.0", id: message.id, result: message.method === "tools/list" ? { tools: [] } : {} });
	});
	document.getElementById("retry").addEventListener("click", async () => {
		try { render(unwrap(await request("tools/call", { name: "studio_setup_retry", arguments: {} })).structuredContent); } catch {}
		poll();
	});
	request("ui/initialize", { appInfo: { name: "WordPress Studio setup", version: "1.0.0" }, appCapabilities: {}, protocolVersion: "2026-01-26" })
		.then((result) => { send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }); applyContext(result && result.hostContext); poll(); })
		.catch(() => poll());
})();
</script>
</body>
</html>`;

studio = findStudio();
if ( studio ) {
	startStudio();
	scheduleUpdateCheck( FIRST_UPDATE_CHECK_MS );
} else {
	install();
}
