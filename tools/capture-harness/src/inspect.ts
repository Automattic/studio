import { writeFile } from 'node:fs/promises';
import { resolveLocator } from './locators.ts';
import { runScripts } from './run.ts';
import { screenshotWindow, tidyText } from './still.ts';
import type { DriverName } from './drivers/types.ts';
import type { LoadedScene } from './scene.ts';
import type { LocatorSpec, Script, Step } from './schema.ts';
import type { LoadedScript } from './script.ts';

export interface InspectOptions {
	scene?: LoadedScene;
	look?: string;
	driver?: DriverName;
	// Open as this script does, and run its shots' steps up to and including `until`.
	script?: LoadedScript;
	until?: string;
	// Launch options when there is no script.
	launch?: Pick< Script, 'firstRun' | 'signedIn' | 'previewSites' | 'connectedSites' | 'chats' >;
	// More steps to run before looking.
	steps?: Step[];
	within?: LocatorSpec;
	screenshot?: string;
	keepProfile?: boolean;
	log?: ( message: string ) => void;
}

export interface InspectResult {
	studioVersion: string | null;
	// The window's accessibility tree, as Playwright's ARIA snapshot (YAML):
	// each line a role and accessible name, the two a locator matches on.
	snapshot: string;
	screenshot?: string;
}

/**
 * Opens a scene the way a script would and returns the accessibility tree of
 * what the window shows, so an agent can write role-and-name locators for the
 * next step without guessing.
 */
export async function inspect( options: InspectOptions ): Promise< InspectResult > {
	const base: LoadedScript = options.script ?? {
		name: 'inspect',
		description: 'Inspect',
		file: `${ process.cwd() }/inspect.json`,
		shots: [],
		...options.launch,
	};
	const index = options.until
		? base.shots.findIndex( ( shot ) => shot.name === options.until )
		: options.script
		? base.shots.length - 1
		: -1;
	if ( options.until && index < 0 ) {
		throw new Error( `No shot "${ options.until }" in ${ base.name }` );
	}
	// The shots before `until` run in full; `until`'s steps and any extra ones run last.
	const shots = base.shots.slice( 0, Math.max( 0, index ) );
	const last = index >= 0 ? base.shots[ index ] : null;
	const script: LoadedScript = {
		...base,
		manual: false,
		shots: [
			...shots,
			{
				name: 'inspect-here',
				description: 'Where to look',
				steps: [ ...( last?.steps ?? [] ), ...( options.steps ?? [] ) ],
			},
		],
	};
	let snapshot = '';
	let screenshot: string | undefined;
	const result = await runScripts( {
		scripts: [ script ],
		mode: 'inspect',
		outDir: process.cwd(),
		scene: options.scene,
		look: options.look,
		driver: options.driver,
		only: new Set( [ 'inspect-here' ] ),
		keepProfile: options.keepProfile,
		log: options.log,
		inspect: async ( ctx ) => {
			await ctx.w.waitForTimeout( 700 );
			await tidyText( ctx );
			const root = options.within ? resolveLocator( ctx, options.within ) : ctx.w.locator( 'body' );
			snapshot = await root.first().ariaSnapshot();
			if ( options.screenshot ) {
				await writeFile( options.screenshot, await screenshotWindow( ctx ) );
				screenshot = options.screenshot;
			}
		},
	} );
	const failed = result.shots.find( ( shot ) => shot.status === 'failed' );
	if ( failed ) {
		throw new Error(
			`${ failed.name } failed: ${ failed.error } (window saved to ${ failed.failure })`
		);
	}
	return { studioVersion: result.studioVersion, snapshot, screenshot };
}
