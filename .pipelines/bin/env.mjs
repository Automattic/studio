#!/usr/bin/env node
/**
 * Give each agent of a Radical Pipelines worktree a WordPress Studio of its own, off the owner's.
 *
 * Usage: node .pipelines/bin/env.mjs <command>
 *
 *   studio --agent <name> -- <cli args>     Run this worktree's `studio` CLI as the agent, and print
 *                                           its output. It builds `apps/cli/dist` first when it is
 *                                           missing or the code changed since, and runs from the
 *                                           agent's sites folder: a relative `--path` is a site there.
 *   ui up --agent <name>                    Start, or confirm running, the agent's `studio ui`, and
 *                                           print its URL. It builds the CLI with the browser UI
 *                                           first when the code changed since.
 *   web up --agent <name>                   The same for Studio on the web (`apps/ui` over its
 *                                           `static` connector), served by Vite from the sources.
 *   playground up --agent <name>            The same for the `apps/ui` playground.
 *   down <ui|web|playground> --agent <name> [--remove]
 *                                           Stop one of the agent's servers; --remove also deletes
 *                                           its log.
 *   down daemon --agent <name> [--remove]   Stop the agent's daemon and sites (`site stop --all`),
 *                                           keeping their data; --remove stops everything the agent
 *                                           runs and deletes its home, with its sites, Studio data,
 *                                           temp files, and ports.
 *   down all [--remove]                     The same for every agent of this worktree, stop its
 *                                           e2e run and its reaper; --remove also deletes the
 *                                           worktree's e2e volumes and install temp files, and
 *                                           unregisters its `.app` bundles from LaunchServices.
 *   test unit [<vitest args>] --agent <name>
 *                                           Run the unit tests as the agent, all or those the
 *                                           arguments select (`--tagsFilter='!e2e'`), without
 *                                           building the CLI.
 *   test cli-e2e [<files>] --agent <name>   Run the CLI e2e tests as the agent, one file at a time:
 *                                           the files given, or every `*.e2e.test.ts` of `apps/cli`.
 *   test e2e [<specs>] [-- <playwright args>] --agent <name>
 *                                           Run the Electron e2e specs given, or the whole suite, in
 *                                           a Linux container (see "Electron e2e tests" below), and
 *                                           copy the results to `test-results/` in the worktree.
 *   eval [<promptfoo args>] --agent <name>  Run the Studio Code evals as `npm run eval` does, as the
 *                                           agent, with the CLI built in its turn, and logged in to
 *                                           WordPress.com as the owner (see "The evals' login").
 *   run --agent <name> -- <command>         Run any command as the agent from the worktree root, once
 *                                           the CLI build is current.
 *   install                                 Install the worktree's dependencies with `npm ci`, its
 *                                           temp files in the worktree and the PHP it downloads in
 *                                           the pipeline cache, retrying network errors.
 *   status                                  What this worktree runs, by agent.
 *   list                                    What every worktree on this machine runs, with memory.
 *   prune [--all]                           Remove what worktrees that no longer exist left: agents'
 *                                           processes and homes, reapers, port claims, LaunchServices
 *                                           registrations, e2e containers and volumes, and stale files
 *                                           in the pipeline cache. --all also removes what every
 *                                           worktree reuses: the pipeline cache, and the e2e image and
 *                                           cache volume.
 *
 * Nothing needs starting first: `studio` starts the agent's daemon the way the CLI does, `ui up`,
 * `web up`, and `playground up` start their server or print the running one's URL, and the
 * commands that need the CLI build make it. Everything an agent runs stops by itself after
 * RP_ENV_IDLE_MINUTES without use, keeping its data: its servers, and its daemon with its sites
 * (`site stop --all`). Use is a command of this script for the agent, or CPU time spent by its
 * servers and PHP (a page being browsed). A detached reaper per worktree does it while anything of
 * the worktree runs, and once the worktree is gone it removes all of it, data included, as `down
 * all --remove` does.
 *
 * An agent is `--agent <name>`, a pipeline's `<pipeline slug>-<role>`. Its Studio processes run with:
 *
 *   HOME                        Its home, `~/.cache/rp-studio/<id>` (the id hashes the worktree and
 *                               the name), so what Studio keeps under `~` stays there: `~/.studio`,
 *                               `~/Library/Application Support/Studio`, and the configs "Connect
 *                               agent app" writes (`~/.claude`, `~/.codex`, `~/.cursor`, `~/.grok`).
 *   DEV_CONFIG_DIR              `<home>/.studio`: its config, sites list, sessions, PHP, WordPress.
 *   STUDIO_PROCESS_MANAGER_HOME `<home>/d`: its own daemon, on a short path for the Unix sockets.
 *   E2E=1, E2E_APP_DATA_PATH, E2E_SITES_ROOT
 *                               Studio's isolation switches: app data under the home, sites in
 *                               `<home>/Studio`, and no stats or Tracks events.
 *   TMPDIR                      `<home>/tmp`.
 *   STUDIO_BASE_PORT            The first site port of the agent's 20 ports, claimed machine-wide
 *                               from 11000-12999 in `~/.cache/rp-studio/ports`: its servers take
 *                               the first three, its sites the rest and up.
 *   PATH                        `<home>/bin` first, with `open` and `xdg-open` shims that log to
 *                               `<home>/.rp/open.log` instead of opening anything; BROWSER=none.
 *   NODE_OPTIONS                `--import` of `agent-hooks.mjs`: `trash` deletes instead of moving
 *                               files to the owner's Trash, logging to `<home>/.rp/trash.log`,
 *                               and `@vscode/sudo-prompt` refuses instead of asking for the
 *                               owner's password (custom domains, HTTPS), logging to `sudo.log`.
 *   IS_DEV_BUILD=true           Builds and runs as development, without Sentry releases.
 *   PROMPTFOO_CONFIG_DIR        `<home>/.promptfoo`.
 *   npm_config_cache, npm_config_userconfig, PLAYWRIGHT_BROWSERS_PATH, GIT_CONFIG_GLOBAL
 *                               The owner's shared caches and settings, which HOME would hide.
 *
 * PHP and WordPress come from the pipeline cache, `~/.cache/rp-studio/shared`, never from the
 * owner's `~/.studio`. Each agent works on a copy-on-write clone of it, so what one agent's Studio
 * writes there, such as its `php.ini` or an interrupted download, never reaches another; what an
 * agent's Studio downloads goes back to the cache once complete, for the agents after it.
 *
 * Builds of `apps/cli/dist` and Vite server starts in a worktree take turns. A build stops every
 * `studio ui` of the worktree's agents, waits for the worktree's running `studio` commands and test
 * runs, stops every agent's daemon with its sites, builds, and starts them again: the servers on
 * their ports, and the daemons with the sites that were running. The `web` and `playground` servers
 * serve the sources, so builds leave them running; each keeps its Vite dependency cache in the
 * agent's home, where no other server's start rewrites it.
 *
 * Electron e2e tests run in Docker, CI's Linux recipe in `e2e/`, never on the host: an image built
 * once for those files (`rp-studio-e2e:<hash>`, starting Docker Desktop when it is down), a work
 * volume per worktree (`rp-studio-e2e-work-<key>`) with its Linux dependencies and packaged app, a
 * volume per worktree for the previous release the `upgrade` spec downloads, and a cache volume
 * every worktree shares (`rp-studio-e2e-cache`). Each run copies the worktree's changes in, installs
 * again when a `package.json` or the lockfile changed, and packages the app again when anything but
 * the specs (`apps/studio/e2e/`, `playwright.config.ts`, `test-fixtures/`) changed. The setup takes
 * about 2.5 minutes the first time, a package about half a minute, and the suite about 4 minutes.
 * The runs in a worktree take turns, and those of the machine start in arrival order, as many at
 * once as Docker has room for: 4 of its CPUs (`docker info`'s NCPU) each, with room for one at
 * least, and 5 GB of its memory each, beyond what its other containers use.
 *
 * The evals' login: `eval` runs logged in to WordPress.com as the owner, and nothing else does, so
 * no other command can publish, pull, or create preview sites on the owner's account. It reads the
 * owner's login without writing it, from the `authToken` of `shared.json` in their Studio config
 * (DEV_CONFIG_DIR, or `~/.studio`), or of `~/Library/Application Support/Studio/appdata-v1.json`
 * for a Studio from before the split config, and copies only that, mode 0600, into a folder of the
 * run's own, `<home>/e<pid>` (0700): the run's config and its temp folder, where the evals copy the
 * config for each case. The run removes the folder when it ends; `prune`, `down all --remove`, the
 * reaper, and the agent's next eval remove what a killed run left. Before it spends anything, it
 * says which account the evals run as and what AI quota that account has left, and stops when the
 * owner's Studio is logged out or the login expired, the account has no Studio Code AI access or
 * credits left, or a case would run on a model tier Studio does not unlock for the account.
 *
 * Settings, from the environment:
 *
 *   RP_ENV_IDLE_MINUTES         Minutes without use before an agent's servers, daemon, and sites
 *                               stop, keeping their data; 0 keeps them running (default: 30).
 *   RP_STUDIO_CACHE             Where the homes, port claims, and cache live (default:
 *                               ~/.cache/rp-studio). Keep it short: the daemons' sockets are in it.
 *
 * Exit codes: 0 success, 1 failure, 2 usage error.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = fileURLToPath( import.meta.url );
const TOOLS = path.dirname( SCRIPT );
const ROOT = path.resolve( TOOLS, '../..' );
const KEY = sha256( ROOT ).slice( 0, 12 );
// The account's home, not $HOME: the processes this script starts run with an agent's HOME, and
// every one of them must find the same cache.
const REAL_HOME = os.userInfo().homedir;
const CACHE = process.env.RP_STUDIO_CACHE || path.join( REAL_HOME, '.cache', 'rp-studio' );
const SHARED = path.join( CACHE, 'shared' );
const CLAIMS = path.join( CACHE, 'ports' );
const CLI_MAIN = path.join( ROOT, 'apps', 'cli', 'dist', 'cli', 'main.mjs' );
const BUILD_RECORD = path.join( ROOT, 'apps', 'cli', 'dist', '.rp-build.json' );
const ENV_IDLE = setting( 'RP_ENV_IDLE_MINUTES', 30 ) * 60 * 1000;
const REAP_POLL = Math.max( 5000, Math.min( 60 * 1000, ENV_IDLE / 4 ) );
// CPU seconds an agent's servers and PHP must spend between two looks of the reaper to count as
// used: a page being browsed costs more, an idle server or open event stream less.
const ACTIVE_CPU = 1;
const PORT_FIRST = 11000;
const PORT_BLOCK = 20;
const PORT_BLOCKS = 100;
const SERVERS = {
	ui: { offset: 0, label: 'studio ui' },
	web: { offset: 1, label: 'Studio on the web' },
	playground: { offset: 2, label: 'the apps/ui playground' },
};
const SITE_PORT_OFFSET = 3;
const LSREGISTER =
	'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
// Unix sockets are limited to 104 bytes on macOS, 108 on Linux.
const SOCKET_LIMIT = 103;

function sha256( value ) {
	return createHash( 'sha256' ).update( value ).digest( 'hex' );
}

// A non-negative number from the environment, or the fallback.
function setting( name, fallback ) {
	const value = Number( process.env[ name ] );
	return process.env[ name ] && Number.isFinite( value ) && value >= 0 ? value : fallback;
}

function log( message ) {
	process.stderr.write( `[env] ${ message }\n` );
}

function fail( message, code = 1 ) {
	log( message );
	process.exit( code );
}

function sleep( ms ) {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

function capture( command, args, options = {} ) {
	const result = spawnSync( command, args, {
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		...options,
	} );
	return result.status === 0 ? result.stdout : null;
}

function run( command, args, options = {} ) {
	const result = spawnSync( command, args, { stdio: 'inherit', ...options } );
	return result.status ?? 1;
}

// Runs a command to completion, streaming its output to stderr unless `quiet`, and resolves with
// its status and output.
function runTee( command, args, options = {}, quiet = false ) {
	return new Promise( ( resolve ) => {
		const child = spawn( command, args, { ...options, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
		let output = '';
		const tee = ( stream ) =>
			stream.on( 'data', ( chunk ) => {
				output += chunk;
				if ( ! quiet ) {
					process.stderr.write( chunk );
				}
			} );
		tee( child.stdout );
		tee( child.stderr );
		child.on( 'error', ( error ) => resolve( { status: 1, output: `${ output }${ error.message }` } ) );
		child.on( 'close', ( status ) => resolve( { status: status ?? 1, output } ) );
	} );
}

function tail( text, lines = 60 ) {
	return `${ String( text ).trimEnd().split( '\n' ).slice( -lines ).join( '\n' ) }\n`;
}

function readJson( file ) {
	try {
		return JSON.parse( fs.readFileSync( file, 'utf8' ) );
	} catch {
		return null;
	}
}

function writeJson( file, value ) {
	fs.mkdirSync( path.dirname( file ), { recursive: true } );
	const staging = `${ file }.${ process.pid }.tmp`;
	fs.writeFileSync( staging, `${ JSON.stringify( value, null, '\t' ) }\n` );
	fs.renameSync( staging, file );
}

function inside( child, parent ) {
	const relative = path.relative( parent, child );
	return relative === '' || ( ! relative.startsWith( '..' ) && ! path.isAbsolute( relative ) );
}

function ago( ms ) {
	const minutes = Math.round( ( Date.now() - ms ) / 60000 );
	return minutes < 1 ? 'just now' : `${ minutes } minute${ minutes === 1 ? '' : 's' } ago`;
}

function gb( bytes ) {
	return `${ ( bytes / 1024 ** 3 ).toFixed( 2 ) } GB`;
}

// Runs `fn` holding a lock folder. Everyone holds it for moments, so one older than 30 seconds
// belongs to a process that died holding it.
async function withLock( lock, fn ) {
	fs.mkdirSync( path.dirname( lock ), { recursive: true } );
	for (;;) {
		try {
			fs.mkdirSync( lock );
			break;
		} catch ( error ) {
			if ( error.code !== 'EEXIST' ) {
				throw error;
			}
			let age = 0;
			try {
				age = Date.now() - fs.statSync( lock ).mtimeMs;
			} catch {
				continue;
			}
			if ( age > 30000 ) {
				fs.rmSync( lock, { recursive: true, force: true } );
				continue;
			}
			await sleep( 50 );
		}
	}
	try {
		return await fn();
	} finally {
		fs.rmSync( lock, { recursive: true, force: true } );
	}
}

/* Processes */

function processes() {
	const output = capture( 'ps', [ '-Aww', '-o', 'pid=,ppid=,pgid=,etime=,time=,rss=,args=' ] ) || '';
	return output
		.split( '\n' )
		.filter( Boolean )
		.map( ( line ) => {
			const match = line.trim().match( /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(.*)$/ );
			if ( ! match ) {
				return null;
			}
			const [ , pid, ppid, pgid, etime, time, rss, command ] = match;
			return {
				pid: Number( pid ),
				ppid: Number( ppid ),
				pgid: Number( pgid ),
				elapsed: duration( etime ),
				cpu: duration( time ),
				rss: Number( rss ) * 1024,
				command,
				args: command.split( /\s+/ ),
			};
		} )
		.filter( Boolean );
}

// Seconds in `ps` times: `[[dd-]hh:]mm:ss[.cc]`.
function duration( text ) {
	const [ days, rest ] = text.includes( '-' ) ? text.split( '-' ) : [ 0, text ];
	return (
		Number( days ) * 86400 +
		rest
			.split( ':' )
			.map( Number )
			.reduce( ( total, part ) => total * 60 + part, 0 )
	);
}

function isScript( proc ) {
	return proc.args[ 1 ]?.endsWith( `${ path.sep }env.mjs` ) && proc.args[ 1 ].includes( '.pipelines' );
}

function scriptRoot( proc ) {
	return path.isAbsolute( proc.args[ 1 ] || '' )
		? path.resolve( path.dirname( proc.args[ 1 ] ), '../..' )
		: null;
}

function reapers( all = processes() ) {
	return all
		.filter( ( proc ) => isScript( proc ) && proc.args[ 2 ] === '_reap' )
		.map( ( proc ) => ( { ...proc, key: proc.args[ 4 ] } ) );
}

// This process and the ones that started it, which nothing here may stop.
function lineage( all ) {
	const pids = new Set();
	let pid = process.pid;
	while ( pid && ! pids.has( pid ) ) {
		pids.add( pid );
		pid = all.find( ( proc ) => proc.pid === pid )?.ppid;
	}
	return pids;
}

function signal( pid, name = 'SIGTERM' ) {
	try {
		process.kill( pid, name );
		return true;
	} catch {
		return false;
	}
}

// Stops processes: SIGTERM, then SIGKILL for those still running after `grace` ms. Never this
// process or those that started it.
async function stopPids( pids, grace = 5000 ) {
	const spared = lineage( processes() );
	const targets = [ ...new Set( pids ) ].filter( ( pid ) => pid > 1 && ! spared.has( pid ) );
	if ( ! targets.length ) {
		return;
	}
	targets.forEach( ( pid ) => signal( pid ) );
	for ( let waited = 0; waited < grace; waited += 250 ) {
		await sleep( 250 );
		const alive = new Set( processes().map( ( proc ) => proc.pid ) );
		if ( ! targets.some( ( pid ) => alive.has( pid ) ) ) {
			return;
		}
	}
	targets.forEach( ( pid ) => signal( pid, 'SIGKILL' ) );
}

// The processes holding a Unix socket under `folder`, such as a daemon whose home it is.
function socketHolders( folder ) {
	const output = capture( 'lsof', [ '-nP', '-U', '-F', 'pn' ] ) || '';
	const pids = new Set();
	let pid = 0;
	for ( const line of output.split( '\n' ) ) {
		if ( line.startsWith( 'p' ) ) {
			pid = Number( line.slice( 1 ) );
		} else if ( line.startsWith( 'n' ) && inside( line.slice( 1 ), folder ) ) {
			pids.add( pid );
		}
	}
	return [ ...pids ];
}

function isListening( socket ) {
	return new Promise( ( resolve ) => {
		if ( ! fs.existsSync( socket ) ) {
			resolve( false );
			return;
		}
		const client = net.connect( socket );
		const done = ( value ) => {
			client.destroy();
			resolve( value );
		};
		client.setTimeout( 1000, () => done( false ) );
		client.once( 'connect', () => done( true ) );
		client.once( 'error', () => done( false ) );
	} );
}

/* Agents and their homes */

// Agent names are `<pipeline slug>-<role>`. Normalized to path-safe slugs.
function slug( agent ) {
	return String( agent || '' )
		.toLowerCase()
		.replace( /[^a-z0-9-]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

function requireAgent( agent ) {
	const name = slug( agent );
	if ( ! name ) {
		fail( 'This command needs --agent <agent name>.', 2 );
	}
	return name;
}

function homeOf( agent, root = ROOT ) {
	return path.join( CACHE, sha256( `${ root }\n${ agent }` ).slice( 0, 10 ) );
}

function layout( home ) {
	return {
		home,
		config: path.join( home, '.studio' ),
		daemon: path.join( home, 'd' ),
		sites: path.join( home, 'Studio' ),
		appData: path.join( home, 'Library', 'Application Support' ),
		tmp: path.join( home, 'tmp' ),
		promptfoo: path.join( home, '.promptfoo' ),
		rp: path.join( home, '.rp' ),
		bin: path.join( home, 'bin' ),
	};
}

// Every agent home on the machine, with the worktree and agent it belongs to.
function homes() {
	let names = [];
	try {
		names = fs.readdirSync( CACHE );
	} catch {
		return [];
	}
	return names.flatMap( ( name ) => {
		const record = readJson( path.join( CACHE, name, 'rp.json' ) );
		return record?.root && record?.agent
			? [ { ...record, ...layout( path.join( CACHE, name ) ) } ]
			: [];
	} );
}

function ownHomes() {
	return homes().filter( ( home ) => home.root === ROOT );
}

function isWorktree( directory ) {
	return !! directory && fs.existsSync( path.join( directory, '.git' ) );
}

const SHIMS = [ 'open', 'xdg-open' ];

function shim( dirs ) {
	const logFile = path.join( dirs.rp, 'open.log' );
	return [
		'#!/bin/sh',
		'# Written by .pipelines/bin/env.mjs: what runs as a pipeline agent opens no window.',
		`printf '%s %s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$0")" >> '${ logFile }'`,
		`for arg in "$@"; do printf ' %s' "$arg" >> '${ logFile }'; done`,
		`printf '\\n' >> '${ logFile }'`,
		'exit 0',
		'',
	].join( '\n' );
}

function prepareHome( agent ) {
	const dirs = layout( homeOf( agent ) );
	if ( path.join( dirs.daemon, 'daemon-events.sock' ).length > SOCKET_LIMIT ) {
		fail(
			`The agent's daemon socket path would pass the ${ SOCKET_LIMIT }-byte limit of Unix sockets. Set RP_STUDIO_CACHE to a shorter folder.`
		);
	}
	for ( const dir of Object.values( dirs ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	const recordFile = path.join( dirs.home, 'rp.json' );
	if ( ! readJson( recordFile ) ) {
		writeJson( recordFile, { root: ROOT, agent, created: new Date().toISOString() } );
	}
	const content = shim( dirs );
	for ( const name of SHIMS ) {
		const file = path.join( dirs.bin, name );
		if ( ! fs.existsSync( file ) || fs.readFileSync( file, 'utf8' ) !== content ) {
			fs.writeFileSync( file, content );
		}
		fs.chmodSync( file, 0o755 );
	}
	seed( dirs.config );
	return dirs;
}

// The owner's own settings and caches, which an agent's HOME would hide.
function ownerSettings() {
	const settings = {
		npm_config_cache: process.env.npm_config_cache || path.join( REAL_HOME, '.npm' ),
		PLAYWRIGHT_BROWSERS_PATH:
			process.env.PLAYWRIGHT_BROWSERS_PATH ||
			( process.platform === 'darwin'
				? path.join( REAL_HOME, 'Library', 'Caches', 'ms-playwright' )
				: path.join( REAL_HOME, '.cache', 'ms-playwright' ) ),
	};
	const npmrc = process.env.npm_config_userconfig || path.join( REAL_HOME, '.npmrc' );
	if ( fs.existsSync( npmrc ) ) {
		settings.npm_config_userconfig = npmrc;
	}
	const gitConfig = [
		process.env.GIT_CONFIG_GLOBAL,
		path.join( REAL_HOME, '.gitconfig' ),
		path.join( process.env.XDG_CONFIG_HOME || path.join( REAL_HOME, '.config' ), 'git', 'config' ),
	].find( ( file ) => file && fs.existsSync( file ) );
	if ( gitConfig ) {
		settings.GIT_CONFIG_GLOBAL = gitConfig;
	}
	return settings;
}

// What would lead an agent's Studio back to the owner's files, or to another Studio.
const UNSET = [
	'ELECTRON_RUN_AS_NODE',
	'CLAUDE_CONFIG_DIR',
	'CODEX_HOME',
	'GROK_HOME',
	'XDG_CONFIG_HOME',
	'XDG_DATA_HOME',
	'XDG_CACHE_HOME',
	'XDG_STATE_HOME',
	'E2E_CLI_CONFIG_PATH',
	'E2E_SHARED_CONFIG_PATH',
	'E2E_HOME_PATH',
	'STUDIO_CLI_BIN',
	'STUDIO_LOCAL_UI_DIST',
	'STUDIO_LOCAL_SERVER_PORT',
	'STUDIO_UI_SERVER',
	'STUDIO_BUNDLED_PHP_BIN_ROOT',
	'SENTRY_AUTH_TOKEN',
	'TMP',
	'TEMP',
];

// The agent's home, port block, and the environment its Studio processes run with.
async function agentEnv( agent ) {
	const dirs = prepareHome( agent );
	const base = await claimPorts( agent );
	const env = { ...process.env };
	for ( const name of UNSET ) {
		delete env[ name ];
	}
	const hook = `--import=${ pathToFileURL( path.join( TOOLS, 'agent-hooks.mjs' ) ).href }`;
	const nodeOptions = ( env.NODE_OPTIONS || '' )
		.split( /\s+/ )
		.filter( ( option ) => option && ! option.includes( 'agent-hooks.mjs' ) );
	Object.assign( env, ownerSettings(), {
		HOME: dirs.home,
		DEV_CONFIG_DIR: dirs.config,
		STUDIO_PROCESS_MANAGER_HOME: dirs.daemon,
		E2E: '1',
		E2E_APP_DATA_PATH: dirs.appData,
		E2E_SITES_ROOT: dirs.sites,
		TMPDIR: `${ dirs.tmp }/`,
		STUDIO_BASE_PORT: String( base + SITE_PORT_OFFSET ),
		PATH: [ dirs.bin, ...( env.PATH || '' ).split( path.delimiter ) ]
			.filter( ( dir, index, list ) => dir && list.indexOf( dir ) === index )
			.join( path.delimiter ),
		BROWSER: 'none',
		IS_DEV_BUILD: 'true',
		PROMPTFOO_CONFIG_DIR: dirs.promptfoo,
		NODE_OPTIONS: [ ...nodeOptions, hook ].join( ' ' ),
		RP_STUDIO_AGENT: agent,
		RP_STUDIO_ROOT: ROOT,
		RP_STUDIO_TRASH_LOG: path.join( dirs.rp, 'trash.log' ),
		RP_STUDIO_SUDO_LOG: path.join( dirs.rp, 'sudo.log' ),
	} );
	return { env, dirs, base };
}

// Confirms that `open` resolves to the agent's shim, and that the shim logs instead of opening.
function checkShim( { env, dirs } ) {
	const found = env.PATH.split( path.delimiter )
		.map( ( dir ) => path.join( dir, 'open' ) )
		.find( ( file ) => {
			try {
				fs.accessSync( file, fs.constants.X_OK );
				return true;
			} catch {
				return false;
			}
		} );
	const logFile = path.join( dirs.rp, 'open.log' );
	const before = fs.existsSync( logFile ) ? fs.statSync( logFile ).size : 0;
	const result = spawnSync( 'open', [ '--rp-shim-check' ], { env, encoding: 'utf8' } );
	const logged = fs.existsSync( logFile ) && fs.readFileSync( logFile, 'utf8' ).slice( before );
	if (
		found !== path.join( dirs.bin, 'open' ) ||
		result.status !== 0 ||
		! String( logged ).includes( '--rp-shim-check' )
	) {
		fail( `The \`open\` shim in ${ dirs.bin } does not work; refusing to start Studio.` );
	}
}

/* Ports */

function claims() {
	let names = [];
	try {
		names = fs.readdirSync( CLAIMS );
	} catch {
		return [];
	}
	return names
		.filter( ( name ) => /^\d+$/.test( name ) )
		.map( ( name ) => ( {
			block: Number( name ),
			base: PORT_FIRST + Number( name ) * PORT_BLOCK,
			folder: path.join( CLAIMS, name ),
			...( readJson( path.join( CLAIMS, name, 'claim.json' ) ) || {} ),
		} ) );
}

// The first of the agent's 20 ports, claimed once for it machine-wide: no other agent's servers or
// sites start there. The owner's Studio starts at 8881. A claim lasts until the agent's home is
// removed; the claims of worktrees that are gone are reused when no block is free.
async function claimPorts( agent ) {
	return withLock( path.join( CACHE, 'ports.lock' ), () => {
		const all = claims();
		const own = all.find( ( claim ) => claim.root === ROOT && claim.agent === agent );
		if ( own ) {
			return own.base;
		}
		const write = ( block ) => {
			writeJson( path.join( CLAIMS, String( block ), 'claim.json' ), {
				root: ROOT,
				agent,
				created: new Date().toISOString(),
			} );
			return PORT_FIRST + block * PORT_BLOCK;
		};
		fs.mkdirSync( CLAIMS, { recursive: true } );
		for ( let block = 0; block < PORT_BLOCKS; block++ ) {
			try {
				fs.mkdirSync( path.join( CLAIMS, String( block ) ) );
				return write( block );
			} catch ( error ) {
				if ( error.code !== 'EEXIST' ) {
					throw error;
				}
			}
		}
		const stale = all.find( ( claim ) => ! isWorktree( claim.root ) );
		if ( stale ) {
			return write( stale.block );
		}
		return fail( `All ${ PORT_BLOCKS } port blocks are claimed. Run \`prune\` or \`down all --remove\`.` );
	} );
}

function releasePorts( match ) {
	for ( const claim of claims() ) {
		if ( match( claim ) ) {
			fs.rmSync( claim.folder, { recursive: true, force: true } );
		}
	}
}

function canBind( port, host ) {
	return new Promise( ( resolve ) => {
		const server = net.createServer();
		server.once( 'error', ( error ) =>
			resolve( error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT' )
		);
		server.listen( port, host, () => server.close( () => resolve( true ) ) );
	} );
}

// As Studio's port finder sees it: free on every local address.
async function isFree( port ) {
	for ( const host of [ '::', '0.0.0.0', '::1', '127.0.0.1' ] ) {
		if ( ! ( await canBind( port, host ) ) ) {
			return false;
		}
	}
	return true;
}

// A free port for a server: its own in the agent's block, else one the system gives.
async function serverPort( base, name ) {
	const own = base + SERVERS[ name ].offset;
	if ( await isFree( own ) ) {
		return own;
	}
	log( `Port ${ own } is taken; ${ SERVERS[ name ].label } gets another.` );
	return new Promise( ( resolve ) => {
		const server = net.createServer();
		server.listen( 0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close( () => resolve( port ) );
		} );
	} );
}

/* PHP and WordPress from the pipeline cache */

// What the pipeline cache holds, by folder under a Studio config folder, and when an entry is
// complete enough to share.
const CACHED = [
	{
		folder: 'php-bin',
		complete: ( dir ) => {
			try {
				const php = fs.statSync( path.join( dir, 'php' ) );
				return (
					php.isFile() &&
					php.size > 1024 * 1024 &&
					( php.mode & 0o111 ) !== 0 &&
					! fs.readdirSync( dir ).some( ( name ) => /\.(zip|tar|gz|tgz)$/.test( name ) )
				);
			} catch {
				return false;
			}
		},
	},
	{
		folder: path.join( 'server-files', 'wordpress-versions' ),
		complete: ( dir ) => fs.existsSync( path.join( dir, 'wp-includes', 'version.php' ) ),
	},
	{
		folder: path.join( 'server-files', 'phpmyadmin-versions' ),
		complete: ( dir ) => fs.existsSync( path.join( dir, 'index.php' ) ),
	},
];

// Staging folders, here and Studio's own (`.partial-`, `.tmp-`), are never entries.
function isEntryName( name ) {
	return ! name.startsWith( '.' ) && ! /\.(partial|tmp|rp)-/.test( name );
}

function entries( folder ) {
	try {
		return fs.readdirSync( folder ).filter( isEntryName );
	} catch {
		return [];
	}
}

// A copy-on-write clone where the file system allows it (APFS), a copy elsewhere.
function cloneTree( source, target ) {
	if ( run( 'cp', [ '-cR', source, target ], { stdio: 'ignore' } ) === 0 ) {
		return true;
	}
	fs.rmSync( target, { recursive: true, force: true } );
	return run( 'cp', [ '-R', source, target ], { stdio: 'ignore' } ) === 0;
}

// Puts a clone of `source` at `target` only complete: cloned beside it, then renamed into place.
// False when `target` appeared meanwhile.
function placeClone( source, target ) {
	const staging = `${ path.dirname( target ) }/.rp-${ path.basename( target ) }-${ process.pid }`;
	fs.mkdirSync( path.dirname( target ), { recursive: true } );
	fs.rmSync( staging, { recursive: true, force: true } );
	if ( ! cloneTree( source, staging ) ) {
		fs.rmSync( staging, { recursive: true, force: true } );
		return false;
	}
	try {
		fs.renameSync( staging, target );
		return true;
	} catch {
		fs.rmSync( staging, { recursive: true, force: true } );
		return false;
	}
}

function wordPressVersion( dir ) {
	try {
		return (
			fs
				.readFileSync( path.join( dir, 'wp-includes', 'version.php' ), 'utf8' )
				.match( /\$wp_version\s*=\s*'([^']+)'/ )?.[ 1 ] || null
		);
	} catch {
		return null;
	}
}

function newerVersion( a, b ) {
	const parts = ( version ) => String( version ).split( /[.-]/ ).map( ( part ) => Number( part ) || 0 );
	const [ x, y ] = [ parts( a ), parts( b ) ];
	for ( let i = 0; i < Math.max( x.length, y.length ); i++ ) {
		if ( ( x[ i ] || 0 ) !== ( y[ i ] || 0 ) ) {
			return ( x[ i ] || 0 ) > ( y[ i ] || 0 );
		}
	}
	return false;
}

// Gives a Studio config folder what the cache has and it lacks.
function seed( config ) {
	for ( const { folder, complete } of CACHED ) {
		const from = path.join( SHARED, folder );
		const to = path.join( config, folder );
		for ( const name of entries( from ) ) {
			if ( ! fs.existsSync( path.join( to, name ) ) && complete( path.join( from, name ) ) ) {
				placeClone( path.join( from, name ), path.join( to, name ) );
			}
		}
	}
}

// Gives the cache what a Studio config folder downloaded: complete entries it lacks, and a newer
// `latest` WordPress.
function harvest( config ) {
	for ( const { folder, complete } of CACHED ) {
		const from = path.join( config, folder );
		const to = path.join( SHARED, folder );
		for ( const name of entries( from ) ) {
			const source = path.join( from, name );
			const target = path.join( to, name );
			if ( ! complete( source ) ) {
				continue;
			}
			if ( ! fs.existsSync( target ) ) {
				placeClone( source, target );
			} else if (
				name === 'latest' &&
				newerVersion( wordPressVersion( source ), wordPressVersion( target ) )
			) {
				const old = `${ to }/.rp-old-latest-${ process.pid }`;
				try {
					fs.renameSync( target, old );
					placeClone( source, target );
				} catch {}
				fs.rmSync( old, { recursive: true, force: true } );
			}
		}
	}
}

// Removes what interrupted copies and downloads left in the cache an hour ago or more.
function cleanCache() {
	const hour = Date.now() - 60 * 60 * 1000;
	for ( const { folder, complete } of CACHED ) {
		const dir = path.join( SHARED, folder );
		let names = [];
		try {
			names = fs.readdirSync( dir );
		} catch {
			continue;
		}
		for ( const name of names ) {
			const entry = path.join( dir, name );
			try {
				if (
					fs.statSync( entry ).mtimeMs < hour &&
					( ! isEntryName( name ) || ! complete( entry ) )
				) {
					log( `Removing ${ entry } from the pipeline cache: incomplete.` );
					fs.rmSync( entry, { recursive: true, force: true } );
				}
			} catch {}
		}
	}
}

/* Use and idle stop */

function usedFile( dirs ) {
	return path.join( dirs.rp, 'used' );
}

function touchUse( dirs ) {
	fs.mkdirSync( dirs.rp, { recursive: true } );
	fs.writeFileSync( usedFile( dirs ), new Date().toISOString() );
}

function lastUse( dirs ) {
	try {
		return fs.statSync( usedFile( dirs ) ).mtimeMs;
	} catch {
		return null;
	}
}

function stoppingFile( dirs ) {
	return path.join( dirs.rp, 'stopping' );
}

// Records that a command uses the agent's Studio, and starts the worktree's reaper when none runs.
// A stop the reaper already began is waited out, so the command starts things again rather than
// use them while they stop.
async function markUsed( dirs ) {
	touchUse( dirs );
	if ( ENV_IDLE && ! reapers().some( ( proc ) => proc.key === KEY ) ) {
		spawn( process.execPath, [ SCRIPT, '_reap', '--key', KEY ], {
			cwd: ROOT,
			detached: true,
			stdio: 'ignore',
		} ).unref();
	}
	let announced = false;
	for (;;) {
		const pid = Number( fs.existsSync( stoppingFile( dirs ) ) && fs.readFileSync( stoppingFile( dirs ), 'utf8' ) );
		if ( ! pid || ! signal( pid, 0 ) ) {
			return;
		}
		if ( ! announced ) {
			log( 'Waiting for the idle stop of this agent to finish.' );
			announced = true;
		}
		await sleep( 500 );
	}
}

// The agents of the worktree whose commands run now: their `_use` processes.
function agentsInUse( all ) {
	return new Set(
		all
			.filter(
				( proc ) => isScript( proc ) && proc.args[ 2 ] === '_use' && proc.args[ 4 ] === KEY
			)
			.map( ( proc ) => proc.args[ 6 ] )
	);
}

// The processes that belong to an agent: those of its servers, and any naming its home, such as
// PHP, which runs from its `.studio/php-bin`.
function agentProcesses( dirs, all ) {
	const groups = new Set(
		Object.keys( SERVERS )
			.map( ( name ) => readJson( serverRecord( dirs, name ) )?.pid )
			.filter( Boolean )
	);
	return all.filter(
		( proc ) =>
			groups.has( proc.pgid ) ||
			( proc.command.includes( `${ dirs.home }/` ) && ! isScript( proc ) )
	);
}

async function agentRuns( dirs, all ) {
	return (
		( await isListening( path.join( dirs.daemon, 'daemon.sock' ) ) ) ||
		agentProcesses( dirs, all ).length > 0
	);
}

// The worktree's reaper. Each poll, it stops what an agent runs once nothing used it for
// ENV_IDLE, keeping its data, and once the worktree is gone it removes all of it, data included.
// Whatever starts something starts it, detached, so it outlives every session; it exits when
// another reaper runs for the worktree, and once nothing of the worktree runs.
async function reap() {
	const cpu = new Map();
	for (;;) {
		const all = processes();
		const me = all.find( ( proc ) => proc.pid === process.pid );
		const elder = reapers( all ).some(
			( proc ) =>
				proc.key === KEY &&
				proc.pid !== process.pid &&
				( ! me ||
					proc.elapsed > me.elapsed ||
					( proc.elapsed === me.elapsed && proc.pid < process.pid ) )
		);
		if ( elder ) {
			return;
		}
		if ( ! isWorktree( ROOT ) ) {
			await removeWhere( ( root ) => root === ROOT );
			unregisterApps( ( bundle ) => inside( bundle, ROOT ) );
			await removeE2e( ( root ) => root === ROOT );
			return;
		}
		const used = agentsInUse( all );
		let busy = used.size > 0;
		for ( const home of ownHomes() ) {
			if ( ! ( await agentRuns( home, all ) ) ) {
				cpu.delete( home.home );
				continue;
			}
			busy = true;
			const spent = agentProcesses( home, all ).reduce( ( total, proc ) => total + proc.cpu, 0 );
			const active = cpu.has( home.home ) && spent - cpu.get( home.home ) >= ACTIVE_CPU;
			cpu.set( home.home, spent );
			if ( used.has( home.agent ) || active || lastUse( home ) === null ) {
				touchUse( home );
			} else if (
				Date.now() - lastUse( home ) >= ENV_IDLE &&
				// Asked again right before stopping: a command may have started since.
				! agentsInUse( processes() ).has( home.agent )
			) {
				log( `Stopping what ${ home.agent } runs: unused for ${ ENV_IDLE / 60000 } minutes.` );
				await stopAgent( home, { quiet: true } );
			}
		}
		harvestAll();
		sweepLogins( ownHomes() );
		if ( ! busy ) {
			return;
		}
		await sleep( REAP_POLL );
	}
}

function harvestAll() {
	for ( const home of ownHomes() ) {
		try {
			harvest( home.config );
		} catch {}
	}
}

/* Builds */

// What `apps/cli/dist` is built from, and what its browser UI is built from, as git pathspecs.
// Tests and the apps and tools the CLI does not bundle are left out, so changing them builds
// nothing.
const NOT_BUILT = [
	':(exclude,glob)**/*.test.*',
	':(exclude,glob)**/tests/**',
	':(exclude,glob)**/test/**',
	':(exclude,glob)**/e2e/**',
	':(exclude,glob)**/__mocks__/**',
];
const CLI_SOURCES = [
	'.',
	...[
		'apps/studio',
		'apps/ui',
		'apps/mcp-ui',
		'docs',
		'scripts',
		'tools',
		'test-fixtures',
		'fastlane',
		'.github',
		'.buildkite',
		'.pipelines',
		'.agents',
		'.devcontainer',
		'.vscode',
		'.bundle',
	].map( ( folder ) => `:(exclude)${ folder }` ),
	':(exclude,glob)*.md',
	...NOT_BUILT,
];
const UI_SOURCES = [
	'apps/ui',
	'apps/static',
	'packages',
	'package.json',
	'package-lock.json',
	...NOT_BUILT,
];

// The content the CLI and its browser UI are built from, committed or not: the sources as they
// are on disk, staged in a copy of the index so that committing them changes nothing. Null when
// git cannot tell.
function sourceFingerprints() {
	const real = capture( 'git', [ 'rev-parse', '--path-format=absolute', '--git-path', 'index' ], {
		cwd: ROOT,
	} )?.trim();
	const index = path.join( os.tmpdir(), `rp-studio-index-${ KEY }-${ process.pid }` );
	try {
		fs.copyFileSync( real, index );
		const git = ( ...args ) =>
			capture( 'git', args, { cwd: ROOT, env: { ...process.env, GIT_INDEX_FILE: index } } );
		if ( git( 'add', '--all', '--', '.' ) === null ) {
			return null;
		}
		const print = ( specs ) => {
			const listing = git( 'ls-files', '-s', '--', ...specs );
			return listing === null ? null : sha256( listing );
		};
		return { cli: print( CLI_SOURCES ), ui: print( UI_SOURCES ) };
	} catch {
		return null;
	} finally {
		fs.rmSync( index, { force: true } );
	}
}

function buildRecord() {
	return readJson( BUILD_RECORD );
}

// Why `kind` (`cli`, or `ui` for the CLI with its browser UI) must be built, or null when it is
// current.
function staleness( kind, prints ) {
	const record = buildRecord();
	if ( ! fs.existsSync( CLI_MAIN ) || ! record ) {
		return 'it was not built here yet';
	}
	// Without git's word on the sources, the build stands.
	if ( ! prints ) {
		return null;
	}
	if ( record.cli !== prints.cli ) {
		return 'the code changed since it was built';
	}
	if ( kind === 'ui' ) {
		if ( ! fs.existsSync( path.join( ROOT, 'apps', 'cli', 'dist', 'cli', 'ui', 'index.local.html' ) ) || ! record.ui ) {
			return 'its browser UI was not built here yet';
		}
		if ( record.ui !== prints.ui ) {
			return 'the browser UI code changed since it was built';
		}
	}
	return null;
}

function builds( all = processes() ) {
	return all.filter(
		( proc ) => isScript( proc ) && proc.args[ 2 ] === '_build' && proc.args[ 4 ] === KEY
	);
}

// Makes `apps/cli/dist` current for `kind`, building it when needed, after waiting for a build the
// worktree runs already.
async function ensureBuilt( kind ) {
	for ( let attempt = 1; attempt <= 3; attempt++ ) {
		await waitForBuilds();
		const reason = staleness( kind, sourceFingerprints() );
		if ( ! reason ) {
			return;
		}
		log( `Building the CLI${ kind === 'ui' ? ' with its browser UI' : '' }: ${ reason }.` );
		const status = await new Promise( ( resolve ) =>
			spawn( process.execPath, [ SCRIPT, '_build', '--key', KEY, kind ], {
				cwd: ROOT,
				stdio: [ 'ignore', 2, 2 ],
			} ).on( 'exit', ( code ) => resolve( code ?? 1 ) )
		);
		if ( status !== 0 ) {
			process.exit( status );
		}
	}
	fail( 'The code kept changing while the CLI was built; run the command again.' );
}

async function waitForBuilds() {
	let announced = false;
	const spared = lineage( processes() );
	while ( builds().some( ( proc ) => ! spared.has( proc.pid ) ) ) {
		if ( ! announced ) {
			log( 'Waiting for the build this worktree runs to finish.' );
			announced = true;
		}
		await sleep( 1000 );
	}
}

// Builds and Vite starts in the worktree take turns: the longest-running `_build` goes first.
async function takeTurn() {
	let announced = false;
	for (;;) {
		const all = processes();
		const mine = all.find( ( proc ) => proc.pid === process.pid );
		const ahead = builds( all ).filter(
			( proc ) =>
				proc.pid !== process.pid &&
				( proc.elapsed > mine.elapsed ||
					( proc.elapsed === mine.elapsed && proc.pid < process.pid ) )
		);
		if ( ! ahead.length ) {
			return;
		}
		if ( ! announced ) {
			log(
				`Another build in this worktree runs (pid ${ ahead
					.map( ( proc ) => proc.pid )
					.join( ', ' ) }); waiting for it to finish.`
			);
			announced = true;
		}
		await sleep( 1000 );
	}
}

// The commands that read `apps/cli/dist` while they run: the CLI's runs, but for the `studio ui`
// servers this script restarts around a build, and the test runs.
function distReaders( all ) {
	const spared = lineage( all );
	return all.filter(
		( proc ) =>
			! spared.has( proc.pid ) &&
			( ( proc.args.includes( CLI_MAIN ) && proc.args[ proc.args.indexOf( CLI_MAIN ) + 1 ] !== 'ui' ) ||
				proc.command.includes( `${ ROOT }/node_modules/vitest/` ) )
	);
}

const BUILD_SCRIPTS = { cli: 'cli:build', ui: 'cli:build:ui' };

// A build, run as `_build`: once its turn comes, it stops the agents' `studio ui` servers, which
// run the CLI for their pages, waits for the worktree's other readers of `apps/cli/dist` to
// finish, stops the agents' daemons, builds, and starts them all again.
async function build( kind ) {
	await takeTurn();
	const before = sourceFingerprints();
	if ( ! staleness( kind, before ) ) {
		return;
	}
	const stopped = await stopServersForBuild();
	let announced = false;
	for ( let quiet = 0; quiet < 2; ) {
		const readers = distReaders( processes() );
		if ( readers.length ) {
			quiet = 0;
			if ( ! announced ) {
				log(
					`Waiting for the commands that use the current build to finish (pid ${ readers
						.map( ( proc ) => proc.pid )
						.join( ', ' ) }).`
				);
				announced = true;
			}
		} else {
			quiet++;
		}
		await sleep( 500 );
	}
	await stopDaemonsForBuild( stopped );
	const started = Date.now();
	const previous = buildRecord();
	const env = { ...process.env, IS_DEV_BUILD: 'true' };
	delete env.SENTRY_AUTH_TOKEN;
	let result;
	try {
		result = await runTee( 'npm', [ 'run', BUILD_SCRIPTS[ kind ] ], { cwd: ROOT, env }, true );
		if ( result.status === 0 ) {
			writeJson( BUILD_RECORD, {
				cli: before?.cli,
				ui: kind === 'ui' ? before?.ui : previous?.ui ?? null,
				built: new Date().toISOString(),
			} );
		}
	} finally {
		await restartAfterBuild( stopped );
	}
	if ( result.status !== 0 ) {
		process.stderr.write( tail( result.output ) );
		fail( `\`npm run ${ BUILD_SCRIPTS[ kind ] }\` failed.` );
	}
	log( `Built the CLI in ${ Math.round( ( Date.now() - started ) / 1000 ) } seconds.` );
}

// Stops the worktree's agents' `studio ui` servers, and returns what to start again, by agent.
async function stopServersForBuild() {
	const stopped = [];
	for ( const home of ownHomes() ) {
		const ui = liveServer( home, 'ui' );
		if ( ui ) {
			await stopServer( home, 'ui' );
		}
		stopped.push( { agent: home.agent, home, sites: [], ui: ui?.port ?? null } );
	}
	return stopped;
}

// Stops the worktree's agents' daemons with their sites, keeping their data, and records the sites
// that ran, to start them again.
async function stopDaemonsForBuild( stopped ) {
	for ( const entry of stopped ) {
		const { home } = entry;
		if ( await isListening( path.join( home.daemon, 'daemon.sock' ) ) ) {
			const { env } = await agentEnv( home.agent );
			const listed = spawnSync( process.execPath, [ CLI_MAIN, 'site', 'list', '--format', 'json' ], {
				cwd: home.sites,
				env,
				encoding: 'utf8',
				timeout: 60000,
			} );
			try {
				const line = listed.stdout.split( '\n' ).find( ( text ) => text.trim().startsWith( '[' ) );
				entry.sites = JSON.parse( line ).filter( ( site ) => site.running ).map( ( site ) => site.path );
			} catch {}
			await stopDaemon( home );
		}
		if ( entry.ui || entry.sites.length ) {
			log(
				`Stopped ${ [ entry.ui && 'studio ui', entry.sites.length && `${ entry.sites.length } site(s)` ]
					.filter( Boolean )
					.join( ' and ' ) } of ${ home.agent } for the build.`
			);
		}
	}
}

async function restartAfterBuild( stopped ) {
	if ( ! fs.existsSync( CLI_MAIN ) ) {
		return;
	}
	for ( const entry of stopped ) {
		if ( ! entry.ui && ! entry.sites.length ) {
			continue;
		}
		const agent = await agentEnv( entry.agent );
		for ( const site of entry.sites ) {
			const result = spawnSync(
				process.execPath,
				[ CLI_MAIN, 'site', 'start', '--path', site, '--skip-browser', '--skip-log-details' ],
				{ cwd: agent.dirs.sites, env: agent.env, encoding: 'utf8', timeout: 180000 }
			);
			log(
				result.status === 0
					? `Started ${ site } of ${ entry.agent } again.`
					: `Could not start ${ site } of ${ entry.agent } again: ${ tail( result.stderr || result.stdout, 5 ).trim() }`
			);
		}
		if ( entry.ui ) {
			const started = await startServer( agent, 'ui', entry.ui );
			log(
				started
					? `Started studio ui of ${ entry.agent } again on ${ started.url }.`
					: `Could not start studio ui of ${ entry.agent } again.`
			);
		}
	}
}

/* Servers */

function serverRecord( dirs, name ) {
	return path.join( dirs.rp, `${ name }.json` );
}

function serverLog( dirs, name ) {
	return path.join( dirs.rp, `${ name }.log` );
}

// The server's record when it runs: its group still has a process started from the worktree.
function liveServer( dirs, name, all = processes() ) {
	const record = readJson( serverRecord( dirs, name ) );
	if ( ! record?.pid ) {
		return null;
	}
	const leader = all.find( ( proc ) => proc.pid === record.pid );
	const leaderOk =
		leader && Math.abs( Date.now() - leader.elapsed * 1000 - record.started ) < 5000;
	const group = all.filter( ( proc ) => proc.pgid === record.pid && proc.command.includes( ROOT ) );
	return leaderOk || group.length ? record : null;
}

// The Vite config an agent's server runs with: the worktree's own, with a dependency cache of its
// own. They would all share `apps/ui/node_modules/.vite`, which a server starting with another
// config rewrites, and for a moment removes, under the others.
function viteConfig( dirs, name ) {
	const file = path.join( dirs.rp, `vite.${ name }.config.mjs` );
	const base = pathToFileURL( path.join( ROOT, 'apps', 'ui', 'vite.config.ts' ) ).href;
	fs.writeFileSync(
		file,
		[
			'// Written by .pipelines/bin/env.mjs.',
			`import config from ${ JSON.stringify( base ) };`,
			`export default { ...config, cacheDir: ${ JSON.stringify( path.join( dirs.rp, `vite-${ name }` ) ) } };`,
			'',
		].join( '\n' )
	);
	return file;
}

function serverCommand( dirs, name, port ) {
	if ( name === 'ui' ) {
		return [ process.execPath, [ CLI_MAIN, 'ui', '--no-open', '--port', String( port ) ] ];
	}
	const script = name === 'web' ? 'dev:static' : 'playground';
	return [
		'npm',
		[
			'-w',
			'@studio/ui',
			'run',
			script,
			'--',
			'--port',
			String( port ),
			'--strictPort',
			'--config',
			viteConfig( dirs, name ),
		],
	];
}

function respond( port ) {
	return new Promise( ( resolve ) => {
		const req = http.get( { host: 'localhost', port, path: '/', timeout: 2000 }, ( res ) => {
			res.resume();
			resolve( true );
		} );
		req.on( 'timeout', () => req.destroy() );
		req.on( 'error', () => resolve( false ) );
	} );
}

// Starts a server detached, in a process group of its own, and waits until it answers. Returns
// its record, or null when it exits or does not answer within 3 minutes.
async function startServer( { env, dirs }, name, port ) {
	checkShim( { env, dirs } );
	const [ command, args ] = serverCommand( dirs, name, port );
	const logFile = serverLog( dirs, name );
	const out = fs.openSync( logFile, 'a' );
	fs.appendFileSync( logFile, `\n[env] ${ new Date().toISOString() } ${ command } ${ args.join( ' ' ) }\n` );
	const child = spawn( command, args, {
		cwd: name === 'ui' ? dirs.sites : ROOT,
		env,
		detached: true,
		stdio: [ 'ignore', out, out ],
	} );
	fs.closeSync( out );
	let exited = false;
	child.on( 'exit', () => ( exited = true ) );
	child.unref();
	const record = {
		pid: child.pid,
		port,
		url: `http://localhost:${ port }/`,
		started: Date.now(),
	};
	writeJson( serverRecord( dirs, name ), record );
	for ( let waited = 0; waited < 180000 && ! exited; waited += 500 ) {
		await sleep( 500 );
		if ( await respond( port ) ) {
			return record;
		}
	}
	process.stderr.write( tail( fs.readFileSync( logFile, 'utf8' ), 30 ) );
	await stopServer( dirs, name );
	return null;
}

async function stopServer( dirs, name ) {
	const record = readJson( serverRecord( dirs, name ) );
	if ( record?.pid ) {
		const members = processes().filter( ( proc ) => proc.pgid === record.pid );
		// The group is the server's while one of its processes runs from the worktree.
		const group = members.some( ( proc ) => proc.command.includes( ROOT ) )
			? members.map( ( proc ) => proc.pid )
			: [];
		if ( group.length ) {
			try {
				process.kill( -record.pid, 'SIGTERM' );
			} catch {}
			await stopPids( group, 10000 );
		}
	}
	fs.rmSync( serverRecord( dirs, name ), { force: true } );
}

function printServer( agent, name, record ) {
	process.stdout.write(
		`${ SERVERS[ name ].label } for ${ agent }: ${ record.url }\n` +
			( name === 'ui'
				? `  Sites: ${ layout( homeOf( agent ) ).sites }\n  CLI: node .pipelines/bin/env.mjs studio --agent ${ agent } -- <args>\n`
				: '' )
	);
}

async function up( agent, name ) {
	const dirs = layout( homeOf( agent ) );
	await markUsed( prepareHome( agent ) );
	if ( name === 'ui' ) {
		await ensureBuilt( 'ui' );
	}
	let record = liveServer( dirs, name );
	if ( ! record ) {
		if ( name === 'ui' ) {
			const agentSetup = await agentEnv( agent );
			record = await startServer( agentSetup, name, await serverPort( agentSetup.base, name ) );
		} else {
			// Vite starts take turns with the builds: its dependency optimizer writes `node_modules/.vite`.
			const status = await new Promise( ( resolve ) =>
				spawn( process.execPath, [ SCRIPT, '_build', '--key', KEY, 'vite', name, agent ], {
					cwd: ROOT,
					stdio: [ 'ignore', 2, 2 ],
				} ).on( 'exit', ( code ) => resolve( code ?? 1 ) )
			);
			record = status === 0 ? liveServer( dirs, name ) : null;
		}
		if ( ! record ) {
			fail( `${ SERVERS[ name ].label } did not start; its log is ${ serverLog( dirs, name ) }.` );
		}
	}
	await markUsed( dirs );
	printServer( agent, name, record );
}

async function startVite( name, agent ) {
	await takeTurn();
	const dirs = layout( homeOf( agent ) );
	if ( liveServer( dirs, name ) ) {
		return;
	}
	const agentSetup = await agentEnv( agent );
	if ( ! ( await startServer( agentSetup, name, await serverPort( agentSetup.base, name ) ) ) ) {
		process.exit( 1 );
	}
}

/* Stopping and removing */

// Stops the agent's daemon and its sites through the CLI, as `site stop --all` does, then whatever
// of them still runs: processes naming the home, and those holding its sockets.
async function stopDaemon( dirs ) {
	if (
		fs.existsSync( CLI_MAIN ) &&
		( await isListening( path.join( dirs.daemon, 'daemon.sock' ) ) )
	) {
		const { env } = await agentEnv( readJson( path.join( dirs.home, 'rp.json' ) ).agent );
		spawnSync( process.execPath, [ CLI_MAIN, 'site', 'stop', '--all' ], {
			cwd: dirs.sites,
			env,
			stdio: 'ignore',
			timeout: 120000,
		} );
	}
	const all = processes();
	const servers = new Set(
		Object.keys( SERVERS )
			.map( ( name ) => readJson( serverRecord( dirs, name ) )?.pid )
			.filter( Boolean )
	);
	await stopPids( [
		...all
			.filter(
				( proc ) =>
					proc.command.includes( `${ dirs.home }/` ) && ! isScript( proc ) && ! servers.has( proc.pgid )
			)
			.map( ( proc ) => proc.pid ),
		...socketHolders( dirs.daemon ),
	] );
}

// Stops everything the agent runs, keeping its data, or with `remove` deletes its home and ports.
// It marks the stop in the home, for `markUsed` to wait out.
async function stopAgent( dirs, { remove = false, quiet = false } = {} ) {
	const { agent, root } = readJson( path.join( dirs.home, 'rp.json' ) ) || {};
	fs.mkdirSync( dirs.rp, { recursive: true } );
	fs.writeFileSync( stoppingFile( dirs ), String( process.pid ) );
	try {
		const stoppedServers = [];
		for ( const name of Object.keys( SERVERS ) ) {
			if ( liveServer( dirs, name ) ) {
				stoppedServers.push( SERVERS[ name ].label );
			}
			await stopServer( dirs, name );
		}
		const daemon = await isListening( path.join( dirs.daemon, 'daemon.sock' ) );
		await stopDaemon( dirs );
		// Test runs leave their own daemons and sites under the home's temp folder.
		await stopPids( [
			...socketHolders( dirs.home ),
			...processes()
				.filter( ( proc ) => proc.command.includes( `${ dirs.home }/` ) && ! isScript( proc ) )
				.map( ( proc ) => proc.pid ),
		] );
		if ( ! quiet ) {
			const what = [ ...stoppedServers, daemon && 'the daemon and its sites' ].filter( Boolean );
			log(
				what.length
					? `Stopped ${ what.join( ', ' ) } of ${ agent }${ remove ? '' : ', keeping their data' }.`
					: `Nothing of ${ agent } was running.`
			);
		}
		try {
			harvest( dirs.config );
		} catch {}
	} finally {
		fs.rmSync( stoppingFile( dirs ), { force: true } );
	}
	if ( remove ) {
		fs.rmSync( dirs.home, { recursive: true, force: true, maxRetries: 5 } );
		releasePorts( ( claim ) => claim.root === root && claim.agent === agent );
		if ( ! quiet ) {
			log( `Removed the home of ${ agent }, with its sites, data, temp files, and ports.` );
		}
	}
}

async function down( target, agent, remove ) {
	const dirs = layout( homeOf( agent ) );
	if ( ! fs.existsSync( dirs.home ) ) {
		log( `${ agent } has no home in this worktree.` );
		return;
	}
	if ( target === 'daemon' ) {
		if ( remove ) {
			await stopAgent( dirs, { remove: true } );
			return;
		}
		const running = await isListening( path.join( dirs.daemon, 'daemon.sock' ) );
		await stopDaemon( dirs );
		harvest( dirs.config );
		log(
			running
				? `Stopped the daemon and sites of ${ agent }, keeping their data.`
				: `The daemon of ${ agent } was not running.`
		);
		return;
	}
	const running = liveServer( dirs, target );
	await stopServer( dirs, target );
	if ( remove ) {
		fs.rmSync( serverLog( dirs, target ), { force: true } );
	}
	log(
		running
			? `Stopped ${ SERVERS[ target ].label } of ${ agent }.`
			: `${ SERVERS[ target ].label } of ${ agent } was not running.`
	);
}

async function downAll( remove ) {
	const all = processes();
	for ( const proc of reapers( all ) ) {
		if ( proc.key === KEY ) {
			signal( proc.pid );
		}
	}
	for ( const home of ownHomes() ) {
		await stopAgent( home, { remove } );
	}
	await removeE2e( ( root ) => root === ROOT, remove === true );
	if ( remove ) {
		releasePorts( ( claim ) => claim.root === ROOT );
		for ( const folder of [ 'rp-tmp', 'rp-install' ] ) {
			fs.rmSync( path.join( ROOT, '.cache', folder ), { recursive: true, force: true } );
		}
		unregisterApps( ( bundle ) => inside( bundle, ROOT ) );
	}
}

// The main checkout of this repository, whose `.worktrees` hold the pipelines' worktrees.
function mainCheckout() {
	const common = capture( 'git', [ 'rev-parse', '--path-format=absolute', '--git-common-dir' ], {
		cwd: ROOT,
	} )?.trim();
	return common ? path.dirname( common ) : null;
}

// The `.app` bundles LaunchServices has registered from paths that `match` accepts, such as the
// Electron app a worktree's `node_modules` holds, are unregistered.
function unregisterApps( match ) {
	if ( process.platform !== 'darwin' || ! fs.existsSync( LSREGISTER ) ) {
		return;
	}
	const dump = capture( LSREGISTER, [ '-dump' ] ) || '';
	const bundles = new Set();
	for ( const line of dump.split( '\n' ) ) {
		const found = line.match( /^path:\s+(.+?\.app)(?: \(0x[0-9a-f]+\))?\s*$/ );
		if ( found && match( found[ 1 ] ) ) {
			bundles.add( found[ 1 ] );
		}
	}
	for ( const bundle of bundles ) {
		run( LSREGISTER, [ '-u', bundle ], { stdio: 'ignore' } );
		log( `Unregistered ${ bundle } from LaunchServices.` );
	}
}

// Removes what this script left on the machine for the worktrees `match` accepts, by their path:
// their reapers, what their agents run, their homes, port claims, and orphaned Studio processes.
async function removeWhere( match ) {
	const all = processes();
	const roots = new Set();
	// Other projects' scripts run reapers too: only this repository's worktrees and the ones its
	// agents have homes or ports for are this script's to stop.
	const main = mainCheckout() || ROOT;
	const known = new Set( [ ...homes(), ...claims() ].map( ( item ) => item.root ) );
	const ours = ( root ) =>
		!! root && ( known.has( root ) || root === main || inside( root, path.join( main, '.worktrees' ) ) );
	for ( const proc of reapers( all ) ) {
		if ( proc.pid !== process.pid && ours( scriptRoot( proc ) ) && match( scriptRoot( proc ) ) ) {
			roots.add( scriptRoot( proc ) );
			log( `Stopping reaper pid ${ proc.pid } (worktree ${ scriptRoot( proc ) } is gone).` );
			signal( proc.pid );
		}
	}
	for ( const home of homes() ) {
		if ( match( home.root ) ) {
			roots.add( home.root );
			log( `Removing the home of ${ home.agent } (worktree ${ home.root } is gone).` );
			await stopAgent( home, { remove: true, quiet: true } );
		}
	}
	for ( const claim of claims() ) {
		if ( match( claim.root ) ) {
			roots.add( claim.root );
		}
	}
	releasePorts( ( claim ) => match( claim.root ) );
	const studio = [ ...roots ].flatMap( ( root ) => [ `${ root }/apps/`, `${ root }/node_modules/` ] );
	await stopPids(
		processes()
			.filter( ( proc ) => ! isScript( proc ) && studio.some( ( prefix ) => proc.command.includes( prefix ) ) )
			.map( ( proc ) => proc.pid )
	);
	return roots;
}

// Whether an `.app` registered in LaunchServices belongs to a worktree that is gone: one of the
// `roots` being removed, or a folder under the worktree folder root `worktrees` with no worktree
// between them. A worktree's folder nests as deep as its branch name, such as `rp/<slug>`.
function bundleGone( bundle, roots, worktrees ) {
	if ( [ ...roots ].some( ( root ) => inside( bundle, root ) ) ) {
		return true;
	}
	if ( ! inside( bundle, worktrees ) ) {
		return false;
	}
	for (
		let dir = path.dirname( bundle );
		dir !== worktrees && inside( dir, worktrees );
		dir = path.dirname( dir )
	) {
		if ( isWorktree( dir ) ) {
			return false;
		}
	}
	return true;
}

async function prune() {
	const main = mainCheckout() || ROOT;
	const worktrees = path.join( main, '.worktrees' );
	const roots = await removeWhere( ( root ) => !! root && ! isWorktree( root ) );
	sweepLogins( homes() );
	unregisterApps( ( bundle ) => bundleGone( bundle, roots, worktrees ) );
	cleanCache();
	await removeE2e( ( root ) => ! isWorktree( root ) );
}

// `prune`, then what every worktree reuses: the e2e image and cache volume, and the pipeline cache
// of PHP and WordPress. The base image the e2e image is built on stays, as do the worktrees' own
// e2e volumes, which `down all --remove` deletes.
async function pruneAll() {
	await prune();
	fs.rmSync( SHARED, { recursive: true, force: true } );
	log( `Removed the pipeline cache ${ SHARED }.` );
	if ( ! dockerUp() ) {
		log( 'Docker is not running: the e2e image and cache volume stay. Run `prune --all` again with Docker up.' );
		return;
	}
	if ( e2eContainers().length ) {
		log( 'An e2e run is in progress: the e2e image and cache volume stay. Run `prune --all` again once it ends.' );
		return;
	}
	const images = (
		capture( 'docker', [ 'images', '--filter', `label=${ E2E_LABEL }=1`, '--format', '{{.Repository}}:{{.Tag}}' ] ) || ''
	)
		.split( '\n' )
		.filter( Boolean );
	for ( const image of images ) {
		run( 'docker', [ 'rmi', image ], { stdio: 'ignore' } );
		log( `Removed the e2e image ${ image }.` );
	}
	if ( run( 'docker', [ 'volume', 'rm', E2E_CACHE_VOLUME ], { stdio: 'ignore' } ) === 0 ) {
		log( `Removed the e2e cache volume ${ E2E_CACHE_VOLUME }.` );
	}
}

/* Electron e2e tests, in Docker */

// The suite runs in a Linux container, CI's recipe in `e2e/`: the worktree is synced read-only into
// a work volume of its own, which keeps the Linux dependencies and packaged app between runs, and a
// cache volume all worktrees share keeps npm's, Electron's, and Playwright's downloads.
const E2E_DIR = path.join( TOOLS, 'e2e' );
const E2E_LABEL = 'rp-studio-e2e';
const E2E_CACHE_VOLUME = 'rp-studio-e2e-cache';
const E2E_MEMORY_GB = 5;
// Docker memory an e2e container needs free, beyond what other containers and the e2e runs already
// started may take.
const E2E_NEED = ( E2E_MEMORY_GB + 0.5 ) * 1024 ** 3;
// Docker CPUs each started e2e run takes: a run averages about 3.4 cores and peaks near 8.
const E2E_CPUS = 4;
const E2E_QUEUE = path.join( CACHE, 'e2e-queue' );
const E2E_RESULTS = path.join( ROOT, 'test-results' );
const STARTED = Date.now() - process.uptime() * 1000;

function workVolume( root = ROOT ) {
	return `rp-studio-e2e-work-${ sha256( root ).slice( 0, 12 ) }`;
}

// The `upgrade` spec downloads the previous release into this folder, deleting it first: each
// worktree has its own, so two first runs never race.
function previousVolume( root = ROOT ) {
	return `rp-studio-e2e-prev-${ sha256( root ).slice( 0, 12 ) }`;
}

// Tagged by its files, so a change to them builds another.
function e2eImage() {
	const files = [ 'Dockerfile', 'entry.sh', 'sync-filter' ]
		.map( ( name ) => fs.readFileSync( path.join( E2E_DIR, name ), 'utf8' ) )
		.join( '\0' );
	return `${ E2E_LABEL }:${ sha256( files ).slice( 0, 12 ) }`;
}

function dockerUp() {
	return capture( 'docker', [ 'info', '--format', '{{.ServerVersion}}' ] ) !== null;
}

async function ensureDocker() {
	if ( dockerUp() ) {
		return;
	}
	if ( process.platform === 'darwin' && fs.existsSync( '/Applications/Docker.app' ) ) {
		log( 'Docker is not running; starting Docker Desktop.' );
		run( 'open', [ '-a', 'Docker' ] );
		for ( let waited = 0; waited < 120; waited += 3 ) {
			await sleep( 3000 );
			if ( dockerUp() ) {
				return;
			}
		}
	}
	fail( 'Docker is not available. Start Docker and try again.' );
}

// Runs `fn` holding a lock folder that records its holder: one whose holder ended is taken over.
async function withPidLock( lock, what, fn ) {
	fs.mkdirSync( path.dirname( lock ), { recursive: true } );
	let announced = false;
	for (;;) {
		try {
			fs.mkdirSync( lock );
			fs.writeFileSync( path.join( lock, 'pid' ), String( process.pid ) );
			break;
		} catch ( error ) {
			if ( error.code !== 'EEXIST' ) {
				throw error;
			}
			let holder = 0;
			try {
				holder = Number( fs.readFileSync( path.join( lock, 'pid' ), 'utf8' ) );
			} catch {}
			let age = 0;
			try {
				age = Date.now() - fs.statSync( lock ).mtimeMs;
			} catch {
				continue;
			}
			if ( holder ? ! signal( holder, 0 ) : age > 10000 ) {
				fs.rmSync( lock, { recursive: true, force: true } );
				continue;
			}
			if ( ! announced ) {
				log( `Waiting for ${ what } (pid ${ holder }).` );
				announced = true;
			}
			await sleep( 2000 );
		}
	}
	try {
		return await fn();
	} finally {
		fs.rmSync( lock, { recursive: true, force: true } );
	}
}

// Builds the image once for its files, one build on the machine at a time.
async function ensureImage() {
	const image = e2eImage();
	const exists = () => capture( 'docker', [ 'image', 'inspect', image ] ) !== null;
	if ( exists() ) {
		return image;
	}
	await withPidLock( path.join( CACHE, 'e2e-image.lock' ), 'another build of the e2e image', async () => {
		if ( exists() ) {
			return;
		}
		log( `Building the e2e image ${ image }, once for the files in ${ E2E_DIR }.` );
		const started = Date.now();
		const result = await runTee(
			'docker',
			[ 'build', '--label', `${ E2E_LABEL }=1`, '--tag', image, E2E_DIR ],
			{},
			true
		);
		if ( result.status !== 0 ) {
			process.stderr.write( tail( result.output ) );
			fail( 'Building the e2e image failed.' );
		}
		log( `Built the e2e image in ${ Math.round( ( Date.now() - started ) / 1000 ) } seconds.` );
	} );
	return image;
}

function ensureVolumes() {
	const create = ( name, labels ) =>
		capture( 'docker', [
			'volume',
			'create',
			...labels.flatMap( ( label ) => [ '--label', label ] ),
			name,
		] ) !== null || fail( `Could not create the Docker volume ${ name }.` );
	create( E2E_CACHE_VOLUME, [ `${ E2E_LABEL }=1` ] );
	for ( const name of [ workVolume(), previousVolume() ] ) {
		create( name, [ `${ E2E_LABEL }=1`, `${ E2E_LABEL }.root=${ ROOT }` ] );
	}
}

// The e2e containers running on the machine, with the run that started each.
function e2eContainers() {
	const format = [ 'ID', 'Names' ]
		.map( ( field ) => `{{.${ field }}}` )
		.concat(
			[ 'root', 'agent', 'pid', 'started' ].map( ( name ) => `{{.Label "${ E2E_LABEL }.${ name }"}}` )
		)
		.join( '\t' );
	return ( capture( 'docker', [ 'ps', '--filter', `label=${ E2E_LABEL }=1`, '--format', format ] ) || '' )
		.split( '\n' )
		.filter( Boolean )
		.map( ( line ) => {
			const [ id, name, root, agent, pid, started ] = line.split( '\t' );
			return { id, name, root, agent, pid: Number( pid ), started: Number( started ) };
		} );
}

// A run's process is alive while its pid runs and started when the run says: pids are reused.
function runAlive( record, all ) {
	const proc = all.find( ( item ) => item.pid === record.pid );
	return !! proc && Math.abs( Date.now() - proc.elapsed * 1000 - record.started ) < 5000;
}

// Stops the e2e containers whose run ended without them, such as one killed with its terminal.
function stopOrphans( all ) {
	for ( const container of e2eContainers() ) {
		if ( ! runAlive( container, all ) ) {
			log( `Stopping e2e container ${ container.name }: the run that started it ended.` );
			run( 'docker', [ 'kill', container.id ], { stdio: 'ignore' } );
		}
	}
}

function readTickets() {
	let names = [];
	try {
		names = fs.readdirSync( E2E_QUEUE );
	} catch {
		return [];
	}
	return names
		.filter( ( name ) => name.endsWith( '.json' ) )
		.map( ( name ) => readJson( path.join( E2E_QUEUE, name ) ) )
		.filter( Boolean )
		.sort( ( a, b ) => a.queued - b.queued || a.id.localeCompare( b.id ) );
}

// The queue's live tickets; those of runs that ended are dropped.
function liveTickets( all ) {
	return readTickets().filter( ( ticket ) => {
		if ( runAlive( ticket, all ) ) {
			return true;
		}
		fs.rmSync( path.join( E2E_QUEUE, `${ ticket.id }.json` ), { force: true } );
		return false;
	} );
}

function describeRun( ticket ) {
	const since = new Date( ticket.granted || ticket.queued ).toTimeString().slice( 0, 5 );
	return `${ path.basename( ticket.root ) } for ${ ticket.agent } since ${ since }`;
}

// Docker's CPUs and memory.
function dockerSize() {
	const [ cpus, memory ] = ( capture( 'docker', [ 'info', '--format', '{{.NCPU}} {{.MemTotal}}' ] ) || '' )
		.trim()
		.split( /\s+/ )
		.map( ( value ) => Number( value ) || 0 );
	return { cpus: cpus || 0, memory: memory || 0 };
}

// The e2e runs Docker's CPUs allow at once: E2E_CPUS each, and at least one.
function e2eCpuRuns( cpus ) {
	return Math.max( 1, Math.floor( cpus / E2E_CPUS ) );
}

// Docker memory left for another e2e container: what its other containers use and what the e2e
// runs already started may take are spoken for.
function e2eMemory( started, total ) {
	const output = capture( 'docker', [ 'stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}' ] ) || '';
	let others = 0;
	for ( const line of output.split( '\n' ).filter( Boolean ) ) {
		const [ name, usage ] = line.split( '\t' );
		if ( ! name.startsWith( `${ E2E_LABEL }-` ) ) {
			others += parseSize( usage.split( '/' )[ 0 ] );
		}
	}
	return { total, others, free: total - others - started * E2E_MEMORY_GB * 1024 ** 3 };
}

function parseSize( text ) {
	const match = String( text ).trim().match( /^([\d.]+)\s*([KMGT]?i?B)$/i );
	if ( ! match ) {
		return 0;
	}
	const binary = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
	const decimal = { B: 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
	const unit = match[ 2 ].toUpperCase();
	return Number( match[ 1 ] ) * ( unit.includes( 'I' ) || unit === 'B' ? binary : decimal )[ unit[ 0 ] ];
}

// Waits for the e2e runs that arrived before this one to start, and for Docker to have the CPUs and
// the memory for its container; what it takes stays taken while this process runs.
async function e2eSlot( agent, specs ) {
	const id = `${ Date.now() }-${ process.pid }`;
	const file = path.join( E2E_QUEUE, `${ id }.json` );
	const ticket = { id, pid: process.pid, started: STARTED, queued: Date.now(), root: ROOT, agent, specs };
	fs.mkdirSync( E2E_QUEUE, { recursive: true } );
	writeJson( file, ticket );
	process.on( 'exit', () => fs.rmSync( file, { force: true } ) );
	let shown = '';
	let reminded = 0;
	for (;;) {
		const all = processes();
		stopOrphans( all );
		let tickets = liveTickets( all );
		const started = tickets.filter( ( item ) => item.granted );
		const waiting = tickets.filter( ( item ) => ! item.granted );
		const ahead = waiting.findIndex( ( item ) => item.id === id );
		const size = dockerSize();
		const cpuRuns = e2eCpuRuns( size.cpus );
		const queued = ahead ? `, and ${ ahead } run${ ahead === 1 ? ' waits' : 's wait' } ahead of this one` : '';
		let message;
		if ( started.length >= cpuRuns ) {
			message = `for CPUs: Docker's ${ size.cpus } CPU${ size.cpus === 1 ? ' takes' : 's take' } ${ cpuRuns } e2e run${
				cpuRuns === 1 ? '' : 's'
			} at once, ${ E2E_CPUS } each, and ${ started.length } ${ started.length === 1 ? 'is' : 'are' } running (${ started
				.map( describeRun )
				.join( '; ' ) })${ queued }`;
		} else if ( ahead > 0 ) {
			message = `for the runs ahead: ${ ahead } e2e run${ ahead === 1 ? ' waits' : 's wait' } ahead of this one (${ waiting
				.slice( 0, ahead )
				.map( describeRun )
				.join( '; ' ) })`;
		} else {
			const memory = e2eMemory( started.length, size.memory );
			if ( memory.free >= E2E_NEED ) {
				const granted = await withLock( path.join( CACHE, 'e2e-queue.lock' ), () => {
					tickets = liveTickets( processes() );
					const first = tickets.find( ( item ) => ! item.granted );
					if ( first?.id !== id || tickets.filter( ( item ) => item.granted ).length >= cpuRuns ) {
						return false;
					}
					writeJson( file, { ...ticket, granted: Date.now() } );
					return true;
				} );
				if ( granted ) {
					return;
				}
				continue;
			}
			message = `for memory: Docker has ${ gb( Math.max( 0, memory.free ) ) } free of ${ gb( memory.total ) } (other containers use ${ gb(
				memory.others
			) }, e2e runs in progress may take ${ started.length * E2E_MEMORY_GB } GB), and an e2e run needs ${ gb( E2E_NEED ) }`;
		}
		// What other containers use changes at every look: only a change of limit is news.
		const key = message.startsWith( 'for memory:' ) ? `memory ${ started.length }` : message;
		if ( key !== shown ) {
			log( `Waiting ${ message }.` );
			shown = key;
			reminded = Date.now();
		} else if ( Date.now() - reminded > 5 * 60 * 1000 ) {
			log( `Still waiting ${ message }.` );
			reminded = Date.now();
		}
		await sleep( 3000 );
	}
}

// Test runs in a worktree take turns: they share its work volume. The longest-running goes first.
async function e2eTurn() {
	let announced = false;
	for (;;) {
		const all = processes();
		const mine = all.find( ( proc ) => proc.pid === process.pid );
		const ahead = all.filter(
			( proc ) =>
				proc.pid !== process.pid &&
				isScript( proc ) &&
				proc.args[ 2 ] === '_use' &&
				proc.args[ 4 ] === KEY &&
				proc.args[ 7 ] === 'test' &&
				proc.args[ 8 ] === 'e2e' &&
				( proc.elapsed > mine.elapsed || ( proc.elapsed === mine.elapsed && proc.pid < process.pid ) )
		);
		if ( ! ahead.length ) {
			return;
		}
		if ( ! announced ) {
			log(
				`Another e2e run in this worktree is in progress (pid ${ ahead
					.map( ( proc ) => proc.pid )
					.join( ', ' ) }); waiting for it to finish.`
			);
			announced = true;
		}
		await sleep( 3000 );
	}
}

async function testE2e( agent, specs ) {
	await e2eTurn();
	await ensureDocker();
	const image = await ensureImage();
	ensureVolumes();
	fs.rmSync( E2E_RESULTS, { recursive: true, force: true } );
	fs.mkdirSync( E2E_RESULTS, { recursive: true } );
	await e2eSlot( agent, specs );
	const name = `${ E2E_LABEL }-${ KEY }-${ process.pid }`;
	const label = ( key, value ) => [ '--label', `${ E2E_LABEL }${ key ? `.${ key }` : '' }=${ value }` ];
	const args = [
		'run',
		'--rm',
		'--init',
		'--name',
		name,
		...label( '', 1 ),
		...label( 'root', ROOT ),
		...label( 'agent', agent ),
		...label( 'pid', process.pid ),
		...label( 'started', STARTED ),
		'--memory',
		`${ E2E_MEMORY_GB }g`,
		'--memory-swap',
		`${ E2E_MEMORY_GB }g`,
		// The PHP proxy listens on ::1 while the readiness checks connect to 127.0.0.1.
		'--sysctl',
		'net.ipv6.conf.all.disable_ipv6=1',
		'--sysctl',
		'net.ipv6.conf.lo.disable_ipv6=1',
		'--sysctl',
		'net.ipv4.ip_unprivileged_port_start=0',
		'--volume',
		`${ ROOT }:/src:ro`,
		'--volume',
		`${ workVolume() }:/work`,
		'--volume',
		`${ E2E_CACHE_VOLUME }:/cache`,
		'--volume',
		`${ previousVolume() }:/tmp/studio-e2e-previous-release`,
		'--volume',
		`${ E2E_RESULTS }:/results`,
		image,
		'run',
		...specs,
	];
	const status = await new Promise( ( resolve ) => {
		const child = spawn( 'docker', args, { stdio: 'inherit' } );
		for ( const sig of [ 'SIGINT', 'SIGTERM' ] ) {
			process.on( sig, () => {
				child.kill( sig );
				spawnSync( 'docker', [ 'kill', name ], { stdio: 'ignore' } );
			} );
		}
		child.on( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );
	log(
		`The e2e run ${ status === 0 ? 'passed' : 'failed' }. Its results, traces, daemon logs, and setup logs: ${ E2E_RESULTS }`
	);
	process.exit( status );
}

// Stops the e2e containers of the worktrees `match` accepts and, with `volumes`, deletes their
// work and previous-release volumes.
async function removeE2e( match, volumes = true ) {
	if ( ! dockerUp() ) {
		if ( capture( 'docker', [ '--version' ] ) !== null ) {
			log( 'Docker is not running: e2e containers and volumes, if any, stay until a `prune` with Docker up.' );
		}
		return;
	}
	for ( const container of e2eContainers() ) {
		if ( container.root && match( container.root ) ) {
			log( `Stopping e2e container ${ container.name }.` );
			run( 'docker', [ 'kill', container.id ], { stdio: 'ignore' } );
		}
	}
	if ( ! volumes ) {
		return;
	}
	const listing =
		capture( 'docker', [
			'volume',
			'ls',
			'--filter',
			`label=${ E2E_LABEL }.root`,
			'--format',
			`{{.Name}}\t{{.Label "${ E2E_LABEL }.root"}}`,
		] ) || '';
	for ( const line of listing.split( '\n' ).filter( Boolean ) ) {
		const [ name, root ] = line.split( '\t' );
		if ( root && match( root ) ) {
			for ( let attempt = 1; attempt <= 5; attempt++ ) {
				if ( run( 'docker', [ 'volume', 'rm', name ], { stdio: 'ignore' } ) === 0 ) {
					log( `Removed the e2e volume ${ name } (${ root }).` );
					break;
				}
				// A container just killed may still hold it for a moment.
				await sleep( 1000 );
			}
		}
	}
}

function e2eLines( all, root ) {
	const lines = [];
	if ( ! dockerUp() ) {
		return lines;
	}
	for ( const container of e2eContainers() ) {
		if ( ! root || container.root === root ) {
			lines.push(
				`e2e: running ${ container.name } for ${ container.agent }${
					root ? '' : ` (${ container.root })`
				}${ runAlive( container, all ) ? '' : ', orphaned: the next e2e run stops it' }`
			);
		}
	}
	const waiting = liveTickets( all ).filter( ( ticket ) => ! ticket.granted && ( ! root || ticket.root === root ) );
	for ( const ticket of waiting ) {
		lines.push( `e2e: ${ describeRun( ticket ) } waits to start` );
	}
	const volumes = (
		capture( 'docker', [
			'volume',
			'ls',
			'--filter',
			`label=${ E2E_LABEL }.root`,
			'--format',
			`{{.Name}}\t{{.Label "${ E2E_LABEL }.root"}}`,
		] ) || ''
	)
		.split( '\n' )
		.filter( Boolean )
		.map( ( line ) => line.split( '\t' ) )
		.filter( ( [ , volumeRoot ] ) => ! root || volumeRoot === root );
	for ( const [ name, volumeRoot ] of volumes ) {
		lines.push(
			`e2e volume: ${ name }${ root ? '' : ` (${ volumeRoot }${ isWorktree( volumeRoot ) ? '' : ', worktree removed: prune' })` }`
		);
	}
	return lines;
}

/* Reports */

async function agentState( home, all ) {
	const servers = Object.keys( SERVERS )
		.map( ( name ) => ( { name, record: liveServer( home, name, all ) } ) )
		.filter( ( server ) => server.record );
	const php = all.filter(
		( proc ) => proc.command.includes( `${ home.config }/php-bin/` ) && ! isScript( proc )
	);
	return {
		daemon: await isListening( path.join( home.daemon, 'daemon.sock' ) ),
		servers,
		php,
		memory: agentProcesses( home, all ).reduce( ( total, proc ) => total + proc.rss, 0 ),
		used: lastUse( home ),
		ports: claims().find( ( claim ) => claim.root === home.root && claim.agent === home.agent ),
	};
}

function describeAgent( home, state ) {
	const ports = state.ports ? `ports ${ state.ports.base }-${ state.ports.base + PORT_BLOCK - 1 }` : 'no ports';
	const lines = [ `${ home.agent } (${ home.home }, ${ ports })` ];
	lines.push(
		`  daemon: ${
			state.daemon
				? `running, ${ state.php.length } PHP process${ state.php.length === 1 ? '' : 'es' }`
				: 'stopped: the next `studio` command starts it'
		}`
	);
	for ( const name of Object.keys( SERVERS ) ) {
		const server = state.servers.find( ( item ) => item.name === name );
		if ( server ) {
			lines.push( `  ${ name }: ${ server.record.url } (pid ${ server.record.pid })` );
		}
	}
	if ( state.used ) {
		lines.push( `  last used: ${ ago( state.used ) }` );
	}
	return lines;
}

async function printStatus() {
	const all = processes();
	const lines = [ `Worktree: ${ ROOT }` ];
	const record = buildRecord();
	if ( ! record || ! fs.existsSync( CLI_MAIN ) ) {
		lines.push( 'CLI build: not built here yet; the first command that needs it builds it' );
	} else {
		const reason = staleness( 'cli', sourceFingerprints() );
		lines.push(
			`CLI build: from ${ record.built }${ record.ui ? ', with the browser UI' : '' }, ${
				reason ? 'out of date: the next command that needs it builds it again' : 'current'
			}`
		);
	}
	const own = ownHomes();
	if ( ! own.length ) {
		lines.push( 'No agent has used Studio in this worktree.' );
	}
	for ( const home of own ) {
		lines.push( ...describeAgent( home, await agentState( home, all ) ) );
	}
	lines.push( ...e2eLines( all, ROOT ) );
	const reaper = reapers( all ).find( ( proc ) => proc.key === KEY );
	lines.push(
		ENV_IDLE
			? `idle stop: after ${ ENV_IDLE / 60000 } minute${ ENV_IDLE === 60000 ? "" : "s" } without use${
					reaper ? ` (reaper pid ${ reaper.pid })` : ''
				}`
			: 'idle stop: off'
	);
	process.stdout.write( `${ lines.join( '\n' ) }\n` );
}

async function printList() {
	const all = processes();
	const byRoot = new Map();
	for ( const home of homes() ) {
		if ( ! byRoot.has( home.root ) ) {
			byRoot.set( home.root, [] );
		}
		byRoot.get( home.root ).push( home );
	}
	const size = capture( 'du', [ '-sk', SHARED ] );
	process.stdout.write(
		`Pipeline cache: ${ SHARED }${ size ? ` (${ gb( Number( size.split( /\s/ )[ 0 ] ) * 1024 ) })` : '' }.\n`
	);
	if ( ! byRoot.size ) {
		process.stdout.write( 'No agent has a Studio home on this machine.\n' );
	}
	const e2e = e2eLines( all );
	if ( e2e.length ) {
		process.stdout.write( `\n${ e2e.join( '\n' ) }\n` );
	}
	for ( const [ root, list ] of byRoot ) {
		const gone = isWorktree( root ) ? '' : ' (worktree removed: prune)';
		process.stdout.write( `\n${ root }${ gone }\n` );
		for ( const home of list ) {
			const state = await agentState( home, all );
			const [ first, ...rest ] = describeAgent( home, state );
			process.stdout.write( `  ${ first }, ${ gb( state.memory ) } in processes\n` );
			for ( const line of rest ) {
				process.stdout.write( `  ${ line }\n` );
			}
		}
	}
}

/* Commands */

async function studio( agent, args ) {
	const setup = await agentEnv( agent );
	await markUsed( setup.dirs );
	checkShim( setup );
	await ensureBuilt( 'cli' );
	const status = await new Promise( ( resolve ) => {
		const child = spawn( process.execPath, [ CLI_MAIN, ...args ], {
			cwd: setup.dirs.sites,
			env: setup.env,
			stdio: 'inherit',
		} );
		for ( const name of [ 'SIGINT', 'SIGTERM' ] ) {
			process.on( name, () => child.kill( name ) );
		}
		child.on( 'exit', ( code, killed ) => resolve( code ?? ( killed ? 1 : 0 ) ) );
	} );
	harvest( setup.dirs.config );
	touchUse( setup.dirs );
	process.exit( status );
}

// The WordPress the CLI e2e tests copy sites from: the harness looks for it in `~/.studio`.
function unpackBundledWordPress( dirs ) {
	const latest = path.join( dirs.config, 'server-files', 'wordpress-versions', 'latest' );
	if ( wordPressVersion( latest ) ) {
		return;
	}
	const zip = path.join( ROOT, 'apps', 'cli', 'dist', 'cli', 'wp-files', 'latest', 'wordpress.zip' );
	if ( ! fs.existsSync( zip ) ) {
		fail( `The CLI build has no bundled WordPress (${ zip }); run \`install\` again.` );
	}
	const staging = `${ latest }.partial-${ process.pid }`;
	fs.rmSync( staging, { recursive: true, force: true } );
	fs.mkdirSync( staging, { recursive: true } );
	try {
		if ( run( 'unzip', [ '-q', zip, '-d', staging ], { stdio: 'ignore' } ) !== 0 ) {
			fail( `Could not unpack ${ zip }.` );
		}
		try {
			fs.renameSync( path.join( staging, 'wordpress' ), latest );
		} catch {}
	} finally {
		fs.rmSync( staging, { recursive: true, force: true } );
	}
}

// Runs a command to completion with the terminal, passing it the signals this process gets.
function runChild( command, args, options ) {
	return new Promise( ( resolve ) => {
		const child = spawn( command, args, { stdio: 'inherit', ...options } );
		for ( const name of [ 'SIGINT', 'SIGTERM' ] ) {
			process.on( name, () => child.kill( name ) );
		}
		child.on( 'error', () => resolve( 1 ) );
		child.on( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );
}

const VITEST = path.join( ROOT, 'node_modules', 'vitest', 'vitest.mjs' );

async function test( kind, agent, args ) {
	switch ( kind ) {
		case 'e2e':
			return testE2e( agent, args );
		case 'unit':
			return testUnit( agent, args );
		case 'cli-e2e':
			break;
		default:
			fail( 'Usage: test <unit|cli-e2e|e2e> [<args>] --agent <name>', 2 );
	}
	const setup = await agentEnv( agent );
	await markUsed( setup.dirs );
	checkShim( setup );
	await ensureBuilt( 'cli' );
	unpackBundledWordPress( setup.dirs );
	const status = await runChild(
		process.execPath,
		[
			VITEST,
			'run',
			'--project',
			'cli',
			'--no-file-parallelism',
			...( args.length ? args : [ '--tagsFilter=e2e', '.e2e.test.ts' ] ),
		],
		{ cwd: ROOT, env: setup.env }
	);
	harvest( setup.dirs.config );
	touchUse( setup.dirs );
	process.exit( status );
}

// Studio's isolation switches, which unit tests set themselves where they need them: with them set,
// the tests that check Studio's default paths and ports would see the agent's.
const UNIT_UNSET = [
	'E2E',
	'E2E_APP_DATA_PATH',
	'E2E_SITES_ROOT',
	'DEV_CONFIG_DIR',
	'STUDIO_PROCESS_MANAGER_HOME',
	'STUDIO_BASE_PORT',
];

// The unit tests run with the agent's HOME and TMPDIR, so what they write in `~` and in temp
// folders lands in its home, and with its shims; they never build the CLI, and never run the CLI
// e2e tests, which `test cli-e2e` runs.
async function testUnit( agent, args ) {
	const setup = await agentEnv( agent );
	await markUsed( setup.dirs );
	checkShim( setup );
	const env = { ...setup.env };
	for ( const name of UNIT_UNSET ) {
		delete env[ name ];
	}
	const status = await runChild( process.execPath, [ VITEST, 'run', '--tagsFilter=!e2e', ...args ], {
		cwd: ROOT,
		env,
	} );
	touchUse( setup.dirs );
	process.exit( status );
}

/* The evals' WordPress.com login */

// The owner's Studio config folder, as their Studio finds it: DEV_CONFIG_DIR, unless it is an
// agent's from this script, else `~/.studio`.
function ownerConfig() {
	const dev = process.env.DEV_CONFIG_DIR;
	return dev && ! inside( path.resolve( dev ), CACHE ) ? path.resolve( dev ) : path.join( REAL_HOME, '.studio' );
}

const LOGIN_FIELDS = [ 'accessToken', 'expiresIn', 'expirationTime', 'id', 'email', 'displayName' ];

// The owner's WordPress.com login, read and never written: the `authToken` of `shared.json` in
// their Studio config, which the Studio app and the CLI of every version since the split config
// write alike, or, from a Studio of before it, the `authToken` of its `appdata-v1.json`. No version
// keeps it in the keychain. Only the login's own fields are kept.
function ownerLogin() {
	const config = ownerConfig();
	const shared = path.join( config, 'shared.json' );
	const files = [ shared ];
	if ( process.platform === 'darwin' && config === path.join( REAL_HOME, '.studio' ) ) {
		files.push( path.join( REAL_HOME, 'Library', 'Application Support', 'Studio', 'appdata-v1.json' ) );
	}
	for ( const file of files ) {
		const token = readJson( file )?.authToken;
		if ( typeof token?.accessToken === 'string' && token.accessToken && Number.isFinite( token.expirationTime ) ) {
			return {
				file,
				version: readJson( shared )?.version ?? 1,
				token: Object.fromEntries( LOGIN_FIELDS.filter( ( name ) => name in token ).map( ( name ) => [ name, token[ name ] ] ) ),
			};
		}
	}
	return { file: shared, token: null };
}

const LOG_IN =
	'Owner: run `studio auth login` in your own Studio (or log in from the Studio app), then run the evals again. Agents cannot log in themselves: `open` is shimmed for them.';

// An eval run's own folder, `<home>/e<pid>`: its config, with the owner's login, and its temp
// folder, where the evals copy that config for each case. Short, for the sockets the cases' process
// managers open in it.
function loginFolders( home ) {
	let names = [];
	try {
		names = fs.readdirSync( home.home );
	} catch {
		return [];
	}
	return names.filter( ( name ) => /^e\d+$/.test( name ) ).map( ( name ) => path.join( home.home, name ) );
}

// Removes the eval folders, with their copies of the owner's login, of runs that ended without
// removing them.
function sweepLogins( list, all = processes() ) {
	for ( const home of list ) {
		for ( const folder of loginFolders( home ) ) {
			const record = readJson( path.join( folder, 'run.json' ) );
			let age = 0;
			try {
				age = Date.now() - fs.statSync( folder ).mtimeMs;
			} catch {
				continue;
			}
			// A folder of a minute or less may belong to a run that started after `all` was read.
			if ( age > 60000 && ! ( record && runAlive( record, all ) ) ) {
				fs.rmSync( folder, { recursive: true, force: true, maxRetries: 3 } );
				log( `Removed ${ folder }, with the WordPress.com login of an eval run that ended.` );
			}
		}
	}
}

// What the WordPress.com AI proxy reports of the account's Studio Code AI quota, as Studio reads
// it (`packages/common/lib/studio-assistant-quota.ts`), or null when it cannot tell.
async function aiQuota( token ) {
	try {
		const response = await fetch( 'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/quota', {
			headers: { Authorization: `Bearer ${ token }` },
			signal: AbortSignal.timeout( 15000 ),
		} );
		const quota = response.ok ? await response.json() : null;
		return quota && typeof quota === 'object' ? quota : null;
	} catch {
		return null;
	}
}

// The WordPress.com model tiers Studio unlocks only for `@a8c.com` and `@automattic.com` emails and
// for accounts that bought AI credits (`requiresPaidAiCredits` in
// `packages/providers/wpcom/descriptor.ts`, `canUsePaidAiModels` in `studio-assistant-quota.ts`).
const PAID_TIERS = [ 'balanced', 'strong' ];

// The eval cases that would run on a paid tier, with it: of those the arguments select, as far as
// `--filter-pattern` tells, the ones whose `model` var, or else STUDIO_EVAL_MODEL, names one.
function paidCases( promptfoo, args, envModel ) {
	const config = path.resolve(
		ROOT,
		promptfoo.match( /(?:^|\s)(?:-c|--config)\s+(\S+)/ )?.[ 1 ] || 'scripts/eval/promptfoo.config.yaml'
	);
	const cases = [];
	let text = '';
	try {
		text = fs.readFileSync( config, 'utf8' );
	} catch {}
	for ( const line of text.split( '\n' ) ) {
		const description = line.match( /^\s*- description:\s*(.+?)\s*$/ );
		const model = line.match( /^\s+model:\s*["']?([\w.:-]+)["']?\s*(#.*)?$/ );
		if ( description ) {
			cases.push( { description: description[ 1 ].replace( /^(["'])(.*)\1$/, '$2' ), model: null } );
		} else if ( model && cases.length ) {
			cases.at( -1 ).model = model[ 1 ];
		}
	}
	const index = args.findIndex( ( arg ) => arg === '--filter-pattern' || arg.startsWith( '--filter-pattern=' ) );
	const pattern = index === -1 ? null : args[ index ].split( '=' ).slice( 1 ).join( '=' ) || args[ index + 1 ];
	let selects = () => true;
	try {
		if ( pattern ) {
			const regex = new RegExp( pattern );
			selects = ( item ) => regex.test( item.description );
		}
	} catch {}
	return cases
		.filter( selects )
		.map( ( item ) => ( { ...item, model: item.model || envModel || 'fast' } ) )
		.filter( ( item ) => PAID_TIERS.includes( item.model ) );
}

function credits( value ) {
	return new Intl.NumberFormat( 'en-US' ).format( value );
}

// Says what the account's AI quota is, and stops when the evals could not run on it.
function checkQuota( quota, user ) {
	if ( ! quota ) {
		log( `Could not read the AI quota of ${ user } from WordPress.com; the evals run without knowing it.` );
		return;
	}
	if ( quota.studio_code_ai_has_access === false ) {
		fail(
			`Studio Code AI is ${ quota.studio_code_ai_access === 'blocked' ? 'blocked' : 'not enabled' } for ${ user } on WordPress.com: the evals would fail.`
		);
	}
	const reset = quota.cost_reset_date ? `, resetting ${ quota.cost_reset_date }` : '';
	const hasPools = quota.allowance_remaining != null || quota.purchased_remaining != null;
	if ( hasPools ) {
		const free = quota.allowance_remaining ?? 0;
		const bought = quota.purchased_remaining;
		log(
			`AI credits of ${ user }: ${ credits( free ) } of the ${ credits( quota.cost_cap ?? 0 ) } of its quota left${ reset }, and ${
				bought == null ? 'an unknown number of' : credits( bought )
			} purchased credits left.`
		);
		if ( free + ( bought ?? 0 ) <= 0 && bought != null ) {
			fail( `${ user } has no AI credits left: the evals would fail.` );
		}
	} else if ( quota.cost_cap > 0 ) {
		log(
			`AI usage of ${ user }: ${ credits( quota.cost_usage ?? 0 ) } of its quota of ${ credits( quota.cost_cap ) } used (${ Math.round(
				( ( quota.cost_usage ?? 0 ) / quota.cost_cap ) * 100
			) }%)${ reset }.`
		);
		if ( ( quota.cost_usage ?? 0 ) >= quota.cost_cap ) {
			fail( `${ user } has used all of its AI quota: the evals would fail.` );
		}
	} else {
		log( `WordPress.com reports no AI quota figures for ${ user }.` );
	}
	log(
		`What the evals spend beyond the quota comes from the AI credits ${ user } purchased, paid by that person.`
	);
}

// Stops when cases would run on a model tier Studio does not unlock for the account, and warns
// when it cannot tell.
function checkTiers( paid, quota, email, user ) {
	if ( ! paid.length ) {
		return;
	}
	const list = paid.map( ( item ) => `"${ item.description }" (${ item.model })` ).join( '; ' );
	const bought = ( quota?.purchased_at_top_up ?? 0 ) > 0 || ( quota?.purchased_remaining ?? 0 ) > 0;
	if ( /@(a8c|automattic)\.com$/i.test( email || '' ) || bought ) {
		return;
	}
	const what = `${ paid.length } eval case${ paid.length === 1 ? ' runs' : 's run' } on a paid model tier: ${ list }. Studio unlocks the paid tiers only for @a8c.com and @automattic.com emails and for accounts that bought AI credits`;
	if ( ! quota ) {
		log( `${ what }; ${ user } has neither such an email nor, as far as WordPress.com said, credits bought: the proxy may refuse them.` );
		return;
	}
	fail(
		`${ what }, and ${ user } is neither. Leave them out with --filter-pattern, or have the owner log in with an account that qualifies.`
	);
}

// The evals, as `npm run eval` runs them, but with the CLI built in its turn and logged in to
// WordPress.com as the owner: the promptfoo command of the `eval` script, with the agent's
// environment and the arguments given, and a config of the run's own with the owner's login. The
// eval runner claims a port range for each case itself, so the agent's base port stays out.
async function evalAs( agent, args ) {
	const setup = await agentEnv( agent );
	await markUsed( setup.dirs );
	checkShim( setup );
	const script = readJson( path.join( ROOT, 'package.json' ) )?.scripts?.eval || '';
	const promptfoo = script
		.split( '&&' )
		.map( ( part ) => part.trim() )
		.find( ( part ) => part.includes( 'promptfoo' ) && ! part.includes( 'cli:build' ) );
	if ( ! promptfoo ) {
		fail( `The \`eval\` script of package.json has no promptfoo command: ${ script }` );
	}
	const login = ownerLogin();
	if ( ! login.token ) {
		fail( `The evals run logged in to WordPress.com as the owner, and the owner's Studio is logged out: ${ login.file } has no login. ${ LOG_IN }` );
	}
	const left = login.token.expirationTime - Date.now();
	if ( left <= 0 ) {
		fail(
			`The evals run logged in to WordPress.com as the owner, and the owner's login in ${ login.file } expired on ${ new Date(
				login.token.expirationTime
			).toISOString() }. ${ LOG_IN }`
		);
	}
	if ( left < 60 * 60 * 1000 ) {
		log( `The owner's WordPress.com login expires in ${ Math.ceil( left / 60000 ) } minutes: cases that run past it fail.` );
	}
	await ensureBuilt( 'cli' );
	const all = processes();
	sweepLogins( [ setup.dirs ], all );
	const folder = path.join( setup.dirs.home, `e${ process.pid }` );
	if ( path.join( folder, 'studio-eval-pm-XXXXXX', 'daemon-events.sock' ).length > SOCKET_LIMIT ) {
		fail( `The evals' daemon socket paths would pass the ${ SOCKET_LIMIT }-byte limit of Unix sockets. Set RP_STUDIO_CACHE to a shorter folder.` );
	}
	// The run's folder goes with it, however it ends: a signal waits for the evals to stop first.
	let child = null;
	process.on( 'exit', () => fs.rmSync( folder, { recursive: true, force: true, maxRetries: 3 } ) );
	for ( const name of [ 'SIGINT', 'SIGTERM', 'SIGHUP' ] ) {
		process.on( name, () => ( child ? child.kill( name ) : process.exit( 128 + os.constants.signals[ name ] ) ) );
	}
	const config = path.join( folder, '.studio' );
	fs.rmSync( folder, { recursive: true, force: true } );
	fs.mkdirSync( config, { recursive: true, mode: 0o700 } );
	fs.chmodSync( folder, 0o700 );
	writeJson( path.join( folder, 'run.json' ), { pid: process.pid, started: STARTED, agent } );
	const shared = path.join( config, 'shared.json' );
	fs.writeFileSync( shared, `${ JSON.stringify( { version: login.version, authToken: login.token }, null, '\t' ) }\n`, {
		mode: 0o600,
		flag: 'wx',
	} );
	fs.chmodSync( shared, 0o600 );
	// What Studio downloads, which the evals link into each case's config, stays the agent's.
	for ( const name of [ 'server-files', 'php-bin', 'import-runtime', 'mu-plugins' ] ) {
		if ( fs.existsSync( path.join( setup.dirs.config, name ) ) ) {
			fs.symlinkSync( path.join( setup.dirs.config, name ), path.join( config, name ) );
		}
	}
	const env = {
		...setup.env,
		TMPDIR: `${ folder }/`,
		E2E_SHARED_CONFIG_PATH: config,
		// The transcripts outlive the run, as they do in `npm run eval`.
		STUDIO_EVAL_SESSION_DIR:
			process.env.STUDIO_EVAL_SESSION_DIR || path.join( setup.dirs.tmp, 'studio-eval-sessions' ),
	};
	// The evals read the run's config, and give each case a copy of it, through E2E_SHARED_CONFIG_PATH,
	// which DEV_CONFIG_DIR would override.
	delete env.DEV_CONFIG_DIR;
	delete env.STUDIO_BASE_PORT;
	const redact = ( text ) => String( text || '' ).split( login.token.accessToken ).join( '[token]' );
	const auth = spawnSync( process.execPath, [ CLI_MAIN, 'auth', 'status', '--format', 'json' ], {
		cwd: setup.dirs.sites,
		env,
		encoding: 'utf8',
		timeout: 60000,
	} );
	let account = null;
	try {
		account = JSON.parse( auth.stdout.slice( auth.stdout.indexOf( '{' ) ) );
	} catch {}
	if ( account?.authenticated !== true ) {
		fail(
			account?.authenticated === false
				? `\`studio auth status\` finds the owner's login from ${ login.file } invalid or expired. ${ LOG_IN }`
				: `WordPress.com did not confirm the owner's login from ${ login.file }: ${ redact(
						tail( auth.stderr || auth.stdout, 3 )
				  )
						.trim()
						.replace( /\.$/, '' ) }. ${ LOG_IN }`
		);
	}
	const user = account.username || account.email || `user ${ account.id }`;
	log(
		`The evals run logged in to WordPress.com as ${ user }${ account.email && account.email !== user ? ` (${ account.email })` : '' }.`
	);
	const quota = await aiQuota( login.token.accessToken );
	checkQuota( quota, user );
	checkTiers(
		paidCases( promptfoo, args, process.env.STUDIO_EVAL_MODEL?.trim() ),
		quota,
		account.email || login.token.email,
		user
	);
	// Every copy of the login the evals write is the owner's alone to read.
	const umask = process.umask( 0o077 );
	const status = await new Promise( ( resolve ) => {
		child = spawn( 'sh', [ '-c', `${ promptfoo } "$@"`, 'eval', ...args ], { cwd: ROOT, env, stdio: 'inherit' } );
		child.on( 'error', () => resolve( 1 ) );
		child.on( 'exit', ( code, killed ) => resolve( code ?? ( killed ? 128 + os.constants.signals[ killed ] : 1 ) ) );
	} );
	child = null;
	process.umask( umask );
	harvest( setup.dirs.config );
	touchUse( setup.dirs );
	process.exit( status );
}

async function runAs( agent, command ) {
	if ( ! command.length ) {
		fail( 'Usage: run --agent <name> -- <command>', 2 );
	}
	const setup = await agentEnv( agent );
	await markUsed( setup.dirs );
	checkShim( setup );
	await ensureBuilt( 'cli' );
	const status = run( command[ 0 ], command.slice( 1 ), { cwd: ROOT, env: setup.env } );
	harvest( setup.dirs.config );
	touchUse( setup.dirs );
	process.exit( status );
}

const NETWORK_ERROR = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket hang up|network/i;

// `npm ci` with its temp files in the worktree, where the postinstall scripts' fixed-name files
// collide with no other install, and the PHP it downloads into the pipeline cache, not `~/.studio`.
async function install() {
	const tmp = path.join( ROOT, '.cache', 'rp-tmp' );
	const config = path.join( ROOT, '.cache', 'rp-install', '.studio' );
	fs.mkdirSync( tmp, { recursive: true } );
	fs.mkdirSync( config, { recursive: true } );
	seed( config );
	const env = { ...process.env, TMPDIR: `${ tmp }/`, DEV_CONFIG_DIR: config, IS_DEV_BUILD: 'true' };
	for ( const name of [ 'TMP', 'TEMP', 'SENTRY_AUTH_TOKEN' ] ) {
		delete env[ name ];
	}
	for ( let attempt = 1; ; attempt++ ) {
		const { status, output } = await runTee( 'npm', [ 'ci', '--no-audit', '--no-fund' ], {
			cwd: ROOT,
			env,
		} );
		if ( status === 0 ) {
			break;
		}
		if ( attempt === 3 || ! NETWORK_ERROR.test( output ) ) {
			fail( `\`npm ci\` failed${ attempt > 1 ? ` after ${ attempt } attempts` : '' }.` );
		}
		log( `\`npm ci\` hit a network error; trying again (attempt ${ attempt + 1 } of 3).` );
	}
	harvest( config );
	for ( const folder of [ tmp, path.dirname( config ) ] ) {
		fs.rmSync( folder, { recursive: true, force: true } );
	}
	log( 'Installed.' );
}

function parse( argv ) {
	const split = argv.indexOf( '--' );
	const head = split === -1 ? argv : argv.slice( 0, split );
	const tailArgs = split === -1 ? [] : argv.slice( split + 1 );
	const options = { positional: [], tail: tailArgs };
	for ( let i = 0; i < head.length; i++ ) {
		if ( head[ i ] === '--agent' ) {
			// Take every word up to the next option, in case a name contains spaces.
			const words = [];
			while ( i + 1 < head.length && ! head[ i + 1 ].startsWith( '--' ) ) {
				words.push( head[ ++i ] );
			}
			options.agent = words.join( ' ' );
		} else if ( head[ i ] === '--remove' ) {
			options.remove = true;

		} else {
			options.positional.push( head[ i ] );
		}
	}
	return options;
}

// The commands that use an agent's Studio, which run as `_use` so the reaper sees them in `ps`.
const USES = [ 'studio', 'ui', 'web', 'playground', 'test', 'run', 'eval' ];

function usage() {
	const lines = fs.readFileSync( SCRIPT, 'utf8' ).split( '\n' );
	process.stderr.write(
		`${ lines
			.slice( 2, lines.indexOf( ' */' ) )
			.map( ( line ) => line.replace( /^ \*\s?/, '' ) )
			.join( '\n' ) }\n`
	);
	process.exit( 2 );
}

async function main() {
	let [ command, ...rest ] = process.argv.slice( 2 );
	let agent;
	switch ( command ) {
		case '_reap':
			return reap();
		case '_build':
			if ( rest[ 2 ] === 'vite' ) {
				return startVite( rest[ 3 ], rest[ 4 ] );
			}
			return build( rest[ 2 ] );
		case '_use':
			agent = rest[ 3 ];
			[ command, ...rest ] = rest.slice( 4 );
			break;
	}
	const options = parse( rest );
	const target = options.positional[ 0 ];
	if ( ! agent && USES.includes( command ) ) {
		// Run again as `_use`, so the reaper and the builds find this command, its worktree, and
		// its agent in `ps`.
		const name = requireAgent( options.agent );
		const child = spawn( process.execPath, [ SCRIPT, '_use', '--key', KEY, '--agent', name, command, ...rest ], {
			stdio: 'inherit',
		} );
		for ( const name of [ 'SIGINT', 'SIGTERM' ] ) {
			process.on( name, () => child.kill( name ) );
		}
		child.on( 'exit', ( code ) => process.exit( code ?? 1 ) );
		return;
	}
	switch ( command ) {
		case 'studio':
			return studio( agent, options.tail );
		case 'ui':
		case 'web':
		case 'playground':
			if ( target === 'up' ) {
				return up( agent, command );
			}
			break;
		case 'test':
			return test( target, agent, options.positional.slice( 1 ).concat( options.tail ) );
		case 'run':
			return runAs( agent, options.tail );
		case 'eval':
			return evalAs( agent, options.positional.concat( options.tail ) );
		case 'down':
			if ( target === 'all' ) {
				return downAll( options.remove );
			}
			if ( [ 'daemon', ...Object.keys( SERVERS ) ].includes( target ) ) {
				return down( target, requireAgent( options.agent ), options.remove );
			}
			break;
		case 'install':
			return install();
		case 'status':
			return printStatus();
		case 'list':
			return printList();
		case 'prune':
			return options.positional.includes( '--all' ) ? pruneAll() : prune();
	}
	usage();
}

await main();
