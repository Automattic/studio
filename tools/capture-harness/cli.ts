#!/usr/bin/env -S node --experimental-strip-types
/**
 * studio-capture: screenshots and recordings of the Studio app from a scene,
 * scripts and a look. See README.md, or `studio-capture help`.
 *
 * Only Node built-ins load up front, so `setup` and `doctor` work on a fresh
 * clone; the commands that need the repo's dependencies load after.
 */
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { DRIVERS, type DriverName } from './src/drivers/types.ts';
import { DEFAULT_SCENE } from './src/paths.ts';
import { doctor, formatChecks, ready, setup } from './src/setup.ts';

const HELP = `studio-capture <command> [options]

Commands:
  setup                   Install and build what captures need (--driver to limit it)
  doctor                  Check this machine and name the fix for anything missing
  capture <script|dir>…   Capture the scripts' shots as stills into --out
  check <script|dir>…     Capture without writing; report which shots' pixels changed
  record <script|dir>…    Record each selected shot's steps as video
  inspect                 Open a scene and print the window's accessibility tree
  validate <file|dir>…    Check scene, script and look files
  bake                    Turn a scene's Blueprint sites into backups
  frame <image>…          Frame existing images with a look
  schemas                 Write the JSON Schemas (--check: fail if out of date)
  list <script|dir>…      List the scripts and their shots

Inputs:
  --scene <name|file>     Scene to open on (default: the script's, else ${ DEFAULT_SCENE })
  --blueprint <file|url>  A one-site scene made from a Blueprint, instead of --scene
  --look <name|file>      Look to capture with (default: the script's, else docs)
  --background <bg>       Frame on another background: dots-light, dots-dark, a color
  --driver <name>         electron (Studio Desktop; the default on macOS, Windows) or browser
                          (\`studio ui\` in headless Chromium: no display needed;
                          the default on Linux)

Options:
  --suite <a,b>           Only these scripts       --only <a,b>    Only these shots
  --out <dir>             Output folder (default ./captures)
  --diff-dir <dir>        check: write pictures of what changed here
  --json                  Print the results as JSON on stdout; progress goes to stderr
  --keep-profile          Keep the throwaway Studio profiles for a look afterwards

inspect: --script <file> [--until <shot>] runs a script's steps first; or
  --first-run, --signed-in to open that way; --steps '<json array>' runs more;
  --within '<locator json>' prints part of the tree; --screenshot <file.png>.
bake: --out <dir> for the backups, --scene-out <file> for the baked scene.
setup: --driver electron|browser (default both), --rebuild to build again.

On Linux without a display, Studio Desktop runs on a virtual one (Xvfb) automatically.
`;

const { values: args, positionals } = parseArgs( {
	allowPositionals: true,
	options: {
		scene: { type: 'string' },
		blueprint: { type: 'string' },
		look: { type: 'string' },
		background: { type: 'string' },
		driver: { type: 'string' },
		suite: { type: 'string' },
		only: { type: 'string' },
		out: { type: 'string' },
		'diff-dir': { type: 'string' },
		json: { type: 'boolean', default: false },
		'keep-profile': { type: 'boolean', default: false },
		script: { type: 'string' },
		until: { type: 'string' },
		'first-run': { type: 'boolean', default: false },
		'signed-in': { type: 'boolean', default: false },
		steps: { type: 'string' },
		within: { type: 'string' },
		screenshot: { type: 'string' },
		'scene-out': { type: 'string' },
		check: { type: 'boolean', default: false },
		rebuild: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false },
	},
} );
const [ command = 'help', ...refs ] = positionals;

// Commands that launch Studio Desktop.
const LAUNCHES = new Set( [ 'capture', 'check', 'record', 'inspect' ] );

/**
 * On Linux without a display, Studio Desktop needs a virtual one: start Xvfb
 * for this run, unless only the browser driver runs. In this process rather
 * than under `xvfb-run`, which merges stderr into stdout and so breaks `--json`.
 */
async function startVirtualDisplay() {
	if (
		process.platform !== 'linux' ||
		process.env.DISPLAY ||
		args.driver === 'browser' ||
		! LAUNCHES.has( command )
	) {
		return;
	}
	// -displayfd: Xvfb picks a free display and writes its number to fd 3. The
	// screen is larger than any window at its scale: Electron shrinks a window to fit it.
	const xvfb = spawn(
		'Xvfb',
		[ '-displayfd', '3', '-screen', '0', '7680x4320x24', '-nolisten', 'tcp' ],
		{ stdio: [ 'ignore', 'ignore', 'ignore', 'pipe' ] }
	);
	const display = await new Promise< string | undefined >( ( resolve ) => {
		let output = '';
		xvfb.stdio[ 3 ]?.on( 'data', ( chunk: Buffer ) => {
			output += chunk.toString();
			if ( output.includes( '\n' ) ) {
				resolve( output.trim() );
			}
		} );
		xvfb.on( 'error', () => resolve( undefined ) );
		xvfb.on( 'exit', () => resolve( undefined ) );
	} );
	if ( ! display ) {
		return;
	}
	process.env.DISPLAY = `:${ display }`;
	// Let the run end on its own; Xvfb goes with it.
	xvfb.stdio[ 3 ]?.destroy();
	xvfb.unref();
	process.on( 'exit', () => xvfb.kill() );
}

function driversOption(): DriverName[] {
	if ( ! args.driver ) {
		return [ ...DRIVERS ];
	}
	if ( ! ( DRIVERS as readonly string[] ).includes( args.driver ) ) {
		throw new Error( `--driver must be one of ${ DRIVERS.join( ', ' ) }.` );
	}
	return [ args.driver as DriverName ];
}

async function main() {
	if ( args.help || command === 'help' ) {
		console.log( HELP );
		return;
	}
	if ( command === 'doctor' ) {
		const checks = doctor();
		const ok = ready( checks, driversOption() );
		if ( args.json ) {
			console.log( JSON.stringify( { ready: ok, checks }, null, 2 ) );
		} else {
			console.log( formatChecks( checks ) );
			console.log(
				ok
					? '\nReady to capture.'
					: '\nNot ready: run `npx studio-capture setup`, or the fixes above.'
			);
		}
		process.exitCode = ok ? 0 : 1;
		return;
	}
	if ( command === 'setup' ) {
		const drivers = driversOption();
		setup( { drivers, rebuild: args.rebuild }, ( message ) => console.error( message ) );
		const checks = doctor();
		console.error( `\n${ formatChecks( checks ) }` );
		if ( ! ready( checks, drivers ) ) {
			throw new Error( 'Setup finished, but something above is still missing.' );
		}
		console.error( '\nReady to capture.' );
		return;
	}
	await startVirtualDisplay();
	if (
		! ready(
			doctor().filter( ( check ) => check.name === 'Dependencies' ),
			[]
		)
	) {
		throw new Error(
			"The repo's dependencies aren't installed. Run `npx studio-capture setup` (or `npm install` at the repo root)."
		);
	}
	const { runCommand } = await import( './src/commands.ts' );
	await runCommand( command, refs, args );
}

main().catch( ( error: Error ) => {
	if ( args.json ) {
		console.log( JSON.stringify( { error: error.message }, null, 2 ) );
	} else {
		console.error( error.message );
	}
	process.exitCode = 1;
} );
