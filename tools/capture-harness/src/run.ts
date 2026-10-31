import path from 'node:path';
import { drawAnnotations } from './annotate.ts';
import { readAuthToken, type AuthToken } from './auth.ts';
import { launchStudio, type Studio } from './launch.ts';
import { loadLook } from './look.ts';
import { DEFAULT_LOOK, DEFAULT_SCENE, firstLine } from './paths.ts';
import { createProfile, type Profile } from './profile.ts';
import { loadScene, type LoadedScene, type ResolvedSite } from './scene.ts';
import { seedChats, seedSites, siteMetadata } from './seed.ts';
import { runSteps } from './steps.ts';
import {
	assertEmailHidden,
	captureFailure,
	captureShot,
	drawWindowControls,
	tidyText,
	type FileResult,
} from './still.ts';
import { startSite, stopAllSites } from './studio-cli.ts';
import { encodeVideo, hideCursor, keepTidy, showCursor, type VideoResult } from './video.ts';
import {
	capturePreviews,
	loadAccount,
	loadPreviewSites,
	loadWpcomSites,
	replaceConnectedSites,
	replacePreviewSites,
	replaceWpcomSites,
	type RemoteEntry,
} from './wpcom.ts';
import type { Ctx } from './context.ts';
import type { DriverName } from './drivers/types.ts';
import type { Look, Shot } from './schema.ts';
import type { LoadedScript } from './script.ts';

export type Mode = 'capture' | 'check' | 'record' | 'inspect';

export interface RunOptions {
	scripts: LoadedScript[];
	mode: Mode;
	outDir: string;
	// Override the scene and look every script names.
	scene?: LoadedScene;
	look?: string;
	// Override the front end every script names.
	driver?: DriverName;
	suites?: Set< string > | null;
	only?: Set< string > | null;
	diffDir?: string;
	keepProfile?: boolean;
	log?: ( message: string ) => void;
	// In inspect mode, what to do at the selected shots instead of capturing.
	inspect?: ( ctx: Ctx ) => Promise< void >;
}

interface ShotResult {
	script: string;
	name: string;
	description: string;
	status: 'ok' | 'failed' | 'skipped';
	files: FileResult[];
	videos?: VideoResult[];
	error?: string;
	// What the window showed when the shot failed.
	failure?: string;
	pages?: string[];
	replaces?: string[];
	meta?: Record< string, unknown >;
}

export interface RunResult {
	mode: Mode;
	studioVersion: string | null;
	outDir: string;
	scripts: {
		name: string;
		description: string;
		scene: string;
		look: string;
		driver: DriverName;
		signedIn: boolean;
	}[];
	shots: ShotResult[];
	manual: { script: string; description: string; pages?: string[]; replaces?: string[] }[];
	summary: {
		new: number;
		changed: number;
		unchanged: number;
		failed: number;
		skipped: number;
		videos: number;
	};
}

/** Selects the scripts and shots a run covers; throws on names that match nothing. */
function selectScripts(
	scripts: LoadedScript[],
	{ suites, only }: Pick< RunOptions, 'suites' | 'only' >
) {
	const runnable = scripts.filter( ( s ) => ! s.manual );
	const unknown = ( kind: string, set: Set< string > | null | undefined, known: string[] ) => {
		const missing = [ ...( set ?? [] ) ].filter( ( name ) => ! known.includes( name ) );
		if ( missing.length ) {
			throw new Error( `Unknown ${ kind }(s): ${ missing.join( ', ' ) }` );
		}
	};
	unknown(
		'script',
		suites,
		runnable.map( ( s ) => s.name )
	);
	unknown(
		'shot',
		only,
		runnable.flatMap( ( s ) => s.shots.map( ( shot ) => shot.name ?? '' ) )
	);
	return runnable.filter(
		( s ) =>
			( ! suites || suites.has( s.name ) ) &&
			( ! only || s.shots.some( ( shot ) => only.has( shot.name ?? '' ) ) )
	);
}

/**
 * The first-run flow depends on the one-dialog welcome added after 2.0.4; an
 * older build shows a full-page welcome with a Skip button instead.
 */
async function assertFirstRunWelcome( ctx: Ctx, version: string ) {
	const dialog = ctx.w.getByRole( 'dialog', { name: 'Welcome to WordPress Studio' } );
	const oldWelcome = ctx.w.getByRole( 'button', { name: 'Skip' } );
	await dialog.or( oldWelcome ).waitFor();
	if ( await oldWelcome.isVisible() ) {
		throw new Error(
			`Studio ${ version } predates the 2.0 welcome dialog first-run scripts need. ` +
				'Capture from a newer build (STUDIO_APP_DIR, see the README).'
		);
	}
}

/**
 * Waits for the scene's site to be running and its front page showing.
 * Studio's site server occasionally crashes while starting (an undici
 * assertion in the server child process), after which Studio serves its "PHP
 * Error Detected" page in the preview; stopping and starting the site again
 * recovers it.
 */
async function ensureSiteRunning( ctx: Ctx, site: ResolvedSite, log: ( m: string ) => void ) {
	const button = ( verb: string ) =>
		ctx.w.getByRole( 'button', { name: `${ verb } ${ site.name }`, exact: true } ).first();
	const previewTitle = async () =>
		( await ctx.studio.inPreviews< string | null >( 'document.title' ) )[ 0 ]?.result ?? '';
	for ( let attempt = 1; ; attempt++ ) {
		await button( 'Stop' ).waitFor( { timeout: 120000 } );
		// After a restart the preview still shows the error page until it reloads.
		let title = '';
		for ( let i = 0; i < 30 && ( ! title || /PHP Error/i.test( title ) ); i++ ) {
			await ctx.w.waitForTimeout( 500 );
			title = ( await previewTitle() ) ?? '';
		}
		if ( title && ! /PHP Error/i.test( title ) ) {
			return;
		}
		if ( attempt >= 3 ) {
			throw new Error(
				`The site's server failed to start ${ attempt } times (Studio shows "${ title }").`
			);
		}
		log(
			`  The site's server failed to start (Studio shows its PHP error page); starting it again...`
		);
		await button( 'Stop' ).click();
		await button( 'Start' ).waitFor( { timeout: 60000 } );
		await button( 'Start' ).click();
	}
}

/**
 * Records a shot: its steps play at a watchable pace with a pointer drawn in,
 * then the last frame holds, with the shot's annotations if it has any.
 */
async function recordShot( ctx: Ctx, shot: Shot, outDir: string, log: ( m: string ) => void ) {
	const { video } = ctx.look;
	const replacements: [ string, string ][] = [
		...ctx.profile.homes.map( ( home ): [ string, string ] => [ home, '/Users/username' ] ),
		...( ctx.email ? [ [ ctx.email, 'you@example.com' ] as [ string, string ] ] : [] ),
	];
	const stopTidy = await keepTidy( ctx, replacements );
	const removeWindowControls = await drawWindowControls( ctx );
	// Earlier shots leave focus rings behind; a recording starts without them.
	await ctx.w.evaluate( () => ( document.activeElement as HTMLElement | null )?.blur?.() );
	if ( video.cursor ) {
		await showCursor( ctx );
	}
	await ctx.w.waitForTimeout( 300 );
	const stopFrames = await ctx.studio.startFrames( video );
	ctx.recording = true;
	let overlay: { remove(): Promise< void > } | null = null;
	let frames;
	try {
		await ctx.w.waitForTimeout( 600 );
		await runSteps( ctx, shot.steps );
		await ctx.w.waitForTimeout( shot.capture?.settle ?? 700 );
		if ( shot.annotate?.length ) {
			overlay = await drawAnnotations( ctx, shot.annotate );
		}
		await ctx.w.waitForTimeout( video.hold );
	} finally {
		ctx.recording = false;
		frames = await stopFrames();
		await overlay?.remove();
		await hideCursor( ctx );
		await removeWindowControls();
		await stopTidy();
	}
	await tidyText( ctx );
	await assertEmailHidden( ctx );
	return encodeVideo( frames, video, path.join( outDir, shot.name ?? 'shot' ), log );
}

interface SceneState {
	scene: LoadedScene;
	profile: Profile;
	wpcom?: {
		remoteSites: RemoteEntry[];
		previewSites: RemoteEntry[];
		previews: Record< string, Buffer >;
	};
}

/**
 * Runs scripts against Studio: each script launches Studio afresh on its
 * scene, so its shots stand on their own. First-run scripts get an empty
 * profile each; the others share one profile per scene, seeded once, whose
 * sites with content Studio starts on launch.
 */
export async function runScripts( options: RunOptions ): Promise< RunResult > {
	const log = options.log ?? ( ( message: string ) => console.log( message ) );
	const selected = selectScripts( options.scripts, options );
	const manual = options.scripts
		.filter( ( s ) => s.manual )
		.flatMap( ( s ) =>
			s.shots.map( ( shot ) => ( {
				script: s.name,
				description: shot.description,
				pages: shot.pages,
				replaces: shot.replaces,
			} ) )
		);

	const scenes = new Map< string, LoadedScene >();
	const looks = new Map< string, Look >();
	const plan: {
		script: LoadedScript;
		scene: LoadedScene;
		look: Look;
		lookName: string;
		driver: DriverName;
	}[] = [];
	for ( const script of selected ) {
		const dir = path.dirname( script.file );
		let scene = options.scene;
		if ( ! scene ) {
			const ref = script.scene ?? DEFAULT_SCENE;
			const key = `${ dir }\0${ ref }`;
			scene = scenes.get( key ) ?? ( await loadScene( ref, dir ) );
			scenes.set( key, scene );
		}
		const lookRef = options.look ?? script.look ?? DEFAULT_LOOK;
		const lookKey = `${ options.look ? process.cwd() : dir }\0${ lookRef }`;
		const look =
			looks.get( lookKey ) ?? ( await loadLook( lookRef, options.look ? undefined : dir ) );
		looks.set( lookKey, look );
		plan.push( {
			script,
			scene,
			look,
			lookName: look.name,
			driver: options.driver ?? script.driver ?? 'electron',
		} );
	}

	// Read before anything else, so a missing login fails the run up front.
	const authToken: AuthToken | null = selected.some( ( s ) => s.signedIn )
		? await readAuthToken()
		: null;

	const result: RunResult = {
		mode: options.mode,
		studioVersion: null,
		outDir: options.outDir,
		scripts: plan.map( ( { script, scene, lookName, driver } ) => ( {
			name: script.name,
			description: script.description,
			scene: scene.name,
			look: lookName,
			driver,
			signedIn: Boolean( script.signedIn ),
		} ) ),
		shots: [],
		manual,
		summary: { new: 0, changed: 0, unchanged: 0, failed: 0, skipped: 0, videos: 0 },
	};

	const profiles: Profile[] = [];
	const states = new Map< LoadedScene, SceneState >();
	const stateFor = async ( scene: LoadedScene, signedIn: boolean ) => {
		let state = states.get( scene );
		if ( ! state ) {
			log( `Creating the sites of scene ${ scene.name }...` );
			const profile = await createProfile();
			profiles.push( profile );
			await seedSites( profile, scene );
			state = { scene, profile };
			states.set( scene, state );
		}
		// Signed-in scripts list made-up WordPress.com sites, not the account's own.
		if ( signedIn && ! state.wpcom ) {
			const remoteSites = await loadWpcomSites( scene );
			const previewSites = await loadPreviewSites( scene );
			log( 'Capturing the WordPress.com site thumbnails...' );
			state.wpcom = {
				remoteSites,
				previewSites,
				previews: await capturePreviews( state.profile, scene.sites, [
					...remoteSites,
					...previewSites,
				] ),
			};
		}
		return state;
	};

	try {
		// Every scene is set up before Studio first launches.
		for ( const { script, scene } of plan ) {
			if ( ! script.firstRun ) {
				await stateFor( scene, Boolean( script.signedIn ) );
			}
		}
		for ( const { script, scene, look, driver } of plan ) {
			log( `\n${ script.name }: ${ script.description }` );
			const firstRun = script.firstRun ?? false;
			const signedIn = Boolean( script.signedIn );
			const state = firstRun ? null : await stateFor( scene, signedIn );
			let profile: Profile;
			if ( state ) {
				profile = state.profile;
			} else {
				profile = await createProfile();
				profiles.push( profile );
			}
			// Studio Desktop starts the sites with content on launch (`autoStart`);
			// `studio ui` doesn't, so they are started for it.
			if ( driver === 'browser' && ! firstRun ) {
				for ( const site of scene.sites.filter( ( s ) => s.content ) ) {
					await startSite( profile, path.join( profile.dirs.sites, site.slug ) );
				}
			}
			// Chats a script opens on (`chats`), recorded under their sites for this launch only.
			const chats = script.chats ? await seedChats( profile, scene, script.chats ) : null;
			let studio: Studio;
			try {
				studio = await launchStudio( driver, {
					profile,
					look,
					firstRun,
					appData: firstRun
						? {}
						: { ...siteMetadata( scene.sites ), aiSessionPlacements: chats?.placements },
					authToken: signedIn ? authToken : null,
					account: signedIn ? await loadAccount( scene ) : undefined,
				} );
			} catch ( error ) {
				await chats?.remove();
				throw error;
			}
			result.studioVersion ??= studio.version;
			if ( signedIn && state?.wpcom && authToken ) {
				await replaceWpcomSites( studio, state.wpcom.remoteSites, state.wpcom.previews );
				if ( script.connectedSites ) {
					await replaceConnectedSites(
						studio,
						state.wpcom.remoteSites,
						scene.sites,
						profile.dirs.sites
					);
				}
				if ( script.previewSites ) {
					await replacePreviewSites(
						studio,
						state.wpcom.previewSites,
						state.wpcom.previews,
						authToken.id
					);
				}
			}
			const ctx: Ctx = {
				studio,
				w: studio.window,
				profile,
				scene,
				look,
				email: signedIn && authToken ? authToken.email : null,
				vars: {
					site: scene.open ?? scene.sites[ 0 ],
					account: signedIn && authToken ? { name: authToken.displayName } : undefined,
				},
			};
			try {
				try {
					if ( firstRun ) {
						await assertFirstRunWelcome( ctx, studio.version );
					} else if ( scene.open ) {
						await ensureSiteRunning( ctx, scene.open, log );
					}
				} catch ( error ) {
					// The script's shots never ran; the next script launches afresh.
					const failure = await captureFailure( ctx, script.name, options.outDir );
					result.shots.push( {
						script: script.name,
						name: '',
						description: 'Opening the scene',
						status: 'failed',
						files: [],
						error: firstLine( error ),
						failure,
					} );
					result.summary.failed++;
					log( `  FAILED   opening the scene: ${ firstLine( error ) }` );
					continue;
				}
				for ( const shot of script.shots ) {
					const name = shot.name ?? '';
					const wanted = ! options.only || options.only.has( name );
					const shotResult: ShotResult = {
						script: script.name,
						name,
						description: shot.description,
						status: 'ok',
						files: [],
						pages: shot.pages,
						replaces: shot.replaces,
						meta: shot.meta,
					};
					if ( shot.desktopOnly && driver === 'browser' ) {
						if ( wanted && options.mode !== 'inspect' ) {
							shotResult.status = 'skipped';
							result.shots.push( shotResult );
							result.summary.skipped++;
							log( `  skipped   ${ name } (Studio Desktop only)` );
						}
						continue;
					}
					try {
						if ( options.mode === 'inspect' && wanted ) {
							await runSteps( ctx, shot.steps );
							await options.inspect?.( ctx );
							result.shots.push( shotResult );
							break;
						}
						if ( options.mode === 'record' && wanted ) {
							shotResult.videos = await recordShot( ctx, shot, options.outDir, log );
							for ( const video of shotResult.videos ) {
								log( `  recorded  ${ path.basename( video.file ) }` );
							}
							result.summary.videos += shotResult.videos.length;
						} else {
							await runSteps( ctx, shot.steps );
						}
						if ( ( options.mode === 'capture' || options.mode === 'check' ) && wanted ) {
							const capture = { ...script.capture, ...shot.capture };
							shotResult.files = await captureShot( ctx, { ...shot, capture }, options.outDir, {
								check: options.mode === 'check',
								diffDir: options.diffDir,
							} );
							for ( const file of shotResult.files ) {
								const label = {
									new: options.mode === 'check' ? 'new      ' : 'saved    ',
									changed: options.mode === 'check' ? 'changed  ' : 'saved    ',
									unchanged: 'unchanged',
								}[ file.status ];
								log( `  ${ label } ${ path.basename( file.file ) }` );
								result.summary[ file.status ]++;
							}
						}
						if ( wanted ) {
							result.shots.push( shotResult );
						}
						await runSteps( ctx, shot.after );
					} catch ( error ) {
						shotResult.status = 'failed';
						shotResult.error = firstLine( error );
						shotResult.failure = await captureFailure( ctx, name, options.outDir );
						result.shots.push( shotResult );
						result.summary.failed++;
						log( `  FAILED   ${ name }: ${ shotResult.error }` );
						log(
							`  Window saved to ${ shotResult.failure }; the rest of this script depends on this step.`
						);
						break;
					}
				}
			} finally {
				await studio.close();
				await chats?.remove();
				// Each profile's sites take ports from the same range, so the next
				// script's (a first run's new site, another scene) would collide.
				await stopAllSites( profile );
			}
		}
	} finally {
		for ( const profile of profiles ) {
			await stopAllSites( profile );
			if ( options.keepProfile ) {
				log( `\nProfile kept at ${ profile.dirs.root }` );
			} else {
				await profile.remove();
			}
		}
	}
	return result;
}
