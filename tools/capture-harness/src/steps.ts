import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fill, resolveLocator, verbOf } from './locators.ts';
import { readJson } from './paths.ts';
import {
	STEP_VERBS,
	type HELPER_NAMES,
	type LocatorSpec,
	type Step,
	type StepVerb,
} from './schema.ts';
import type { Ctx } from './context.ts';
import type { Locator } from 'playwright';

type StepOf< V extends StepVerb > = Extract< Step, Record< V, unknown > >;

// The pause after each step of a recording, so a viewer can follow it.
const RECORDING_PAUSE = 350;

/**
 * In a recording, moves the pointer to `locator` the way a person would
 * before acting on it, rather than jumping there.
 */
async function glideTo( ctx: Ctx, locator: Locator ) {
	if ( ! ctx.recording || ! ctx.look.video.cursor ) {
		return;
	}
	await locator.scrollIntoViewIfNeeded();
	const box = await locator.boundingBox();
	if ( box ) {
		await ctx.w.mouse.move( box.x + box.width / 2, box.y + box.height / 2, { steps: 24 } );
		await ctx.w.waitForTimeout( 150 );
	}
}

/**
 * The steps a shot can run, each an object keyed by its verb (see
 * `STEP_VERBS` in schema.ts for every field). Locators are described in
 * locators.ts.
 */
const STEPS: { [ V in StepVerb ]: ( ctx: Ctx, step: StepOf< V > ) => Promise< void > } = {
	async waitFor( ctx, step ) {
		const wait = resolveLocator( ctx, step.waitFor ).waitFor( {
			state: step.hidden ? 'hidden' : 'visible',
			timeout: step.timeout,
		} );
		await ( step.optional ? wait.catch( () => {} ) : wait );
	},
	async click( ctx, step ) {
		const locator = resolveLocator( ctx, step.click );
		await glideTo( ctx, locator );
		await locator.click( { button: step.button } );
	},
	async hover( ctx, step ) {
		const locator = resolveLocator( ctx, step.hover );
		await glideTo( ctx, locator );
		await locator.hover();
	},
	async fill( ctx, step ) {
		const locator = resolveLocator( ctx, step.fill );
		const value = String( fill( step.value, ctx.vars ) );
		if ( ctx.recording ) {
			await glideTo( ctx, locator );
			await locator.fill( '' );
			await locator.pressSequentially( value, { delay: ctx.look.video.typingDelay } );
		} else {
			await locator.fill( value );
		}
		if ( step.blur ) {
			await locator.blur();
		}
	},
	async press( ctx, step ) {
		await ctx.w.keyboard.press( step.press );
	},
	async toggle( ctx, step ) {
		const spec: LocatorSpec = typeof step.toggle === 'string' ? { name: step.toggle } : step.toggle;
		const locator = resolveLocator( ctx, { role: 'switch', exact: true, ...spec } );
		await glideTo( ctx, locator );
		await locator.setChecked( step.on );
	},
	/**
	 * Scrolls so the element sits `offset` px below the top of its nearest
	 * scrolling ancestor. `scrollIntoView` would land it under Studio's sticky headers.
	 */
	async scrollTo( ctx, step ) {
		await resolveLocator( ctx, step.scrollTo ).evaluate(
			( el, { offset, smooth } ) => {
				let parent = el.parentElement;
				while ( parent ) {
					const { overflowY } = getComputedStyle( parent );
					if ( /(auto|scroll)/.test( overflowY ) && parent.scrollHeight > parent.clientHeight ) {
						break;
					}
					parent = parent.parentElement;
				}
				const scroller = parent ?? ( document.scrollingElement as HTMLElement );
				const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
				scroller.scrollTo( {
					top: scroller.scrollTop + top - offset,
					behavior: smooth ? 'smooth' : 'instant',
				} );
			},
			{ offset: step.offset ?? 40, smooth: Boolean( ctx.recording ) }
		);
	},
	async waitForImages( ctx, step ) {
		await resolveLocator( ctx, step.waitForImages ).evaluate( async ( el ) => {
			// Lists such as the Blueprint gallery add their images once their data loads.
			for ( let i = 0; i < 100 && ! el.querySelector( 'img' ); i++ ) {
				await new Promise( ( resolve ) => setTimeout( resolve, 200 ) );
			}
			const images = [ ...el.querySelectorAll( 'img' ) ];
			for ( const img of images ) {
				img.loading = 'eager';
			}
			const loaded = images.map( ( img ) =>
				img.complete
					? null
					: new Promise( ( resolve ) => {
							img.addEventListener( 'load', resolve, { once: true } );
							img.addEventListener( 'error', resolve, { once: true } );
					  } )
			);
			const timeout = new Promise( ( resolve ) => setTimeout( resolve, 20_000 ) );
			await Promise.race( [ Promise.all( loaded ), timeout ] );
		} );
	},
	async setFiles( ctx, step ) {
		if ( ! ctx.scene.files ) {
			throw new Error( `setFiles: scene ${ ctx.scene.name } has no files folder` );
		}
		await resolveLocator( ctx, step.setFiles ).setInputFiles(
			path.join( ctx.scene.files, step.file )
		);
	},
	async wait( ctx, step ) {
		await ctx.w.waitForTimeout( step.wait );
	},
	async helper( ctx, step ) {
		const helper = HELPERS[ step.helper ];
		if ( ! helper ) {
			throw new Error( `Unknown helper "${ step.helper }"` );
		}
		await helper( ctx, ...( step.args ?? [] ).map( ( arg ) => fill( arg, ctx.vars ) ) );
	},
};

const VERBS = Object.keys( STEP_VERBS ) as StepVerb[];

export async function runSteps( ctx: Ctx, steps: Step[] = [] ) {
	for ( const step of steps ) {
		const verb = verbOf( step, VERBS, 'step' );
		await ( STEPS[ verb ] as ( ctx: Ctx, step: Step ) => Promise< void > )( ctx, step );
		if ( ctx.recording && verb !== 'wait' ) {
			await ctx.w.waitForTimeout( RECORDING_PAUSE );
		}
	}
}

type Helper = ( ctx: Ctx, ...args: ( string | number )[] ) => Promise< void >;

/**
 * Multi-step interactions with Studio that are awkward to spell out in JSON.
 */
export const HELPERS: Record< ( typeof HELPER_NAMES )[ number ], Helper > = {
	/** Opens Add site unless Studio already opened it (it does when there are no sites). */
	async openAddSite( { w } ) {
		const tabs = w.getByRole( 'tablist', { name: 'Ways to add a site' } );
		await tabs.waitFor( { timeout: 10_000 } ).catch( async () => {
			await w.getByRole( 'button', { name: 'Add site' } ).first().click();
			await tabs.waitFor();
		} );
	},

	async closeMenus( { w } ) {
		for ( let i = 0; i < 3 && ( await w.getByRole( 'menu' ).count() ); i++ ) {
			await w.keyboard.press( 'Escape' );
			await w.waitForTimeout( 150 );
		}
		// A menu still animating closed swallows the click that would reopen it.
		await w
			.getByRole( 'menu' )
			.first()
			.waitFor( { state: 'detached', timeout: 2_000 } )
			.catch( () => {} );
	},

	/** Opens the site menu from the site icon at the top of the chat. */
	async openSiteMenu( ctx ) {
		await HELPERS.closeMenus( ctx );
		const button = ctx.w.getByRole( 'button', { name: 'Site menu', exact: true } );
		await glideTo( ctx, button );
		await button.click();
		await ctx.w.getByRole( 'menuitem', { name: 'Delete site' } ).waitFor();
	},

	/**
	 * Opens a site menu submenu and waits for one of its items. The site menu is
	 * reopened first: while another submenu is open, it blocks hovering the rest
	 * of the menu.
	 */
	async openSubmenu( ctx, trigger, item ) {
		await HELPERS.openSiteMenu( ctx );
		const submenu = ctx.w.getByRole( 'menuitem', { name: String( trigger ), exact: true } );
		await glideTo( ctx, submenu );
		await submenu.hover();
		const target = ctx.w.getByRole( 'menuitem', { name: String( item ), exact: true } );
		await target.waitFor( { timeout: 2_000 } ).catch( async () => {
			await submenu.click();
			await target.waitFor();
		} );
	},

	/**
	 * Clicks the element matching a CSS selector inside the site preview, which
	 * is a <webview> that locators can't reach, at its centre on screen.
	 */
	async clickInPreview( ctx, selector ) {
		const { w } = ctx;
		const [ found ] = await ctx.studio.inPreviews< { x: number; y: number } | null >( `(() => {
			const el = document.querySelector( ${ JSON.stringify( String( selector ) ) } );
			if ( ! el ) return null;
			el.scrollIntoView( { block: 'center' } );
			const box = el.getBoundingClientRect();
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		})()` );
		if ( ! found?.result ) {
			throw new Error( `Nothing in the site preview matches ${ selector }` );
		}
		const point = { x: found.offset.x + found.result.x, y: found.offset.y + found.result.y };
		if ( ctx.recording && ctx.look.video.cursor ) {
			await w.mouse.move( point.x, point.y, { steps: 24 } );
		}
		await w.mouse.click( point.x, point.y );
	},

	/** Types into whatever has focus, such as a field inside the site preview. */
	async typeText( ctx, text ) {
		await ctx.w.keyboard.type( String( text ), {
			delay: ctx.recording ? ctx.look.video.typingDelay : undefined,
		} );
	},

	/**
	 * Drags the separator named `name` (such as "Resize site preview") by `dx`
	 * pixels; positive is to the right.
	 */
	async dragSeparator( { w }, name, dx ) {
		const box = await w
			.getByRole( 'separator', { name: String( name ), exact: true } )
			.boundingBox();
		if ( ! box ) {
			throw new Error( `No separator "${ name }" on screen` );
		}
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await w.mouse.move( x, y );
		await w.mouse.down();
		await w.mouse.move( x + Number( dx ), y, { steps: 12 } );
		await w.mouse.up();
	},

	/** Leaves annotation mode, discarding any notes, without sending them. */
	async discardAnnotations( { w } ) {
		const toolbar = w.getByRole( 'toolbar', { name: 'Annotations' } );
		if ( ! ( await toolbar.count() ) ) {
			return;
		}
		await toolbar.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
		const discard = w.getByRole( 'button', { name: 'Discard', exact: true } );
		await discard.waitFor( { timeout: 2_000 } ).then(
			() => discard.click(),
			() => {}
		);
		await toolbar.waitFor( { state: 'hidden' } );
	},

	/**
	 * Stands in for Studio Code, for shots of a conversation: from here on,
	 * sending a prompt answers with a made-up run instead of starting the
	 * agent, so no model runs and no credits are used. `playAgentTurn` then
	 * plays that run's events. Only the request that would start the run is
	 * answered (an IPC handler on the Desktop, an API route in the browser),
	 * so the renderer is the real one throughout.
	 */
	async stubAgentRuns( { studio } ) {
		await studio.stubs.agentRuns();
	},

	/**
	 * Plays the agent events in the scene's `agentTurns/<name>.json` to the
	 * window as the run `stubAgentRuns` last answered with, as the CLI would
	 * send them. A string `scene:<path>` in an event is a file from the scene's
	 * folder, copied into the profile's sessions folder, where the agent saves
	 * its own previews (Studio only shows local media from there or a site),
	 * and replaced by its path there.
	 */
	async playAgentTurn( { studio, w, profile, scene }, name ) {
		const run = await studio.stubs.lastAgentRun();
		if ( ! run ) {
			throw new Error( 'playAgentTurn: send a prompt after stubAgentRuns first' );
		}
		if ( ! scene.agentTurns ) {
			throw new Error( `playAgentTurn: scene ${ scene.name } has no agentTurns folder` );
		}
		const { events } = await readJson< { events: unknown[] } >(
			path.join( scene.agentTurns, `${ name }.json` )
		);
		// Studio's sessions folder under E2E_APP_DATA_PATH (see createProfile).
		const mediaDir = path.join( profile.dirs.appData, 'sessions', 'capture-media' );
		await mkdir( mediaDir, { recursive: true } );
		const files = new Map< string, string >();
		for ( const match of JSON.stringify( events ).matchAll( /"scene:([^"]+)"/g ) ) {
			const target = path.join( mediaDir, path.basename( match[ 1 ] ) );
			await copyFile( path.join( scene.dir, match[ 1 ] ), target );
			files.set( match[ 1 ], target );
		}
		const resolved = JSON.parse(
			JSON.stringify( events ).replace( /"scene:([^"]+)"/g, ( _m, file: string ) =>
				JSON.stringify( files.get( file ) )
			)
		) as Record< string, unknown >[];
		for ( const event of resolved ) {
			await studio.stubs.sendAgentEvent( {
				runId: run.runId,
				sessionId: run.sessionId,
				event: { timestamp: new Date().toISOString(), ...event },
			} );
			await w.waitForTimeout( 150 );
		}
	},

	/** Undoes unsaved site settings so later shots start clean. */
	async discardSettings( { w } ) {
		const discard = w.getByRole( 'button', { name: 'Discard' } );
		if ( await discard.count() ) {
			await discard.click();
			await discard.waitFor( { state: 'hidden' } );
		}
	},
};
