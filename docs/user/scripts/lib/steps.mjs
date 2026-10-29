import path from 'node:path';
import { FIXTURES_DIR } from './common.mjs';
import { fill, resolveLocator, verbOf } from './locators.mjs';

/**
 * The steps a shot can run, each an object keyed by its verb. Locators are
 * described in locators.mjs.
 *
 *   { "waitFor": LOC, "hidden"?: true, "timeout"?: ms, "optional"?: true }
 *   { "click": LOC, "button"?: "right" }
 *   { "hover": LOC }
 *   { "fill": LOC, "value": "…", "blur"?: true }
 *   { "press": "Escape" }
 *   { "toggle": "Enable HTTPS" | LOC, "on": true }   a switch by name, or any locator
 *   { "scrollTo": LOC, "offset"?: px }       scrolls LOC near the top of its scroll area
 *   { "waitForImages": LOC }                 every <img> inside LOC has loaded
 *   { "setFiles": LOC, "file": "name" }      a file from screenshots/fixtures/
 *   { "wait": ms }
 *   { "helper": "name", "args"?: [...] }     one of HELPERS below
 */
const STEPS = {
	async waitFor( ctx, step ) {
		const wait = resolveLocator( ctx, step.waitFor ).waitFor( {
			state: step.hidden ? 'hidden' : 'visible',
			timeout: step.timeout,
		} );
		await ( step.optional ? wait.catch( () => {} ) : wait );
	},
	async click( ctx, step ) {
		await resolveLocator( ctx, step.click ).click( { button: step.button } );
	},
	async hover( ctx, step ) {
		await resolveLocator( ctx, step.hover ).hover();
	},
	async fill( ctx, step ) {
		const locator = resolveLocator( ctx, step.fill );
		await locator.fill( fill( step.value, ctx.vars ) );
		if ( step.blur ) {
			await locator.blur();
		}
	},
	async press( ctx, step ) {
		await ctx.w.keyboard.press( step.press );
	},
	async toggle( ctx, step ) {
		const spec = typeof step.toggle === 'string' ? { name: step.toggle } : step.toggle;
		await resolveLocator( ctx, { role: 'switch', exact: true, ...spec } ).setChecked( step.on );
	},
	/**
	 * Scrolls so the element sits `offset` px below the top of its nearest
	 * scrolling ancestor. `scrollIntoView` would land it under Studio's sticky headers.
	 */
	async scrollTo( ctx, step ) {
		await resolveLocator( ctx, step.scrollTo ).evaluate( ( el, offset ) => {
			let parent = el.parentElement;
			while ( parent ) {
				const { overflowY } = getComputedStyle( parent );
				if ( /(auto|scroll)/.test( overflowY ) && parent.scrollHeight > parent.clientHeight ) {
					break;
				}
				parent = parent.parentElement;
			}
			parent ??= document.scrollingElement;
			const top = el.getBoundingClientRect().top - parent.getBoundingClientRect().top;
			parent.scrollTo( { top: parent.scrollTop + top - offset, behavior: 'instant' } );
		}, step.offset ?? 40 );
	},
	async waitForImages( ctx, step ) {
		await resolveLocator( ctx, step.waitForImages ).evaluate( async ( el ) => {
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
		await resolveLocator( ctx, step.setFiles ).setInputFiles(
			path.join( FIXTURES_DIR, step.file )
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

export async function runSteps( ctx, steps = [] ) {
	for ( const step of steps ) {
		await STEPS[ verbOf( step, Object.keys( STEPS ), 'step' ) ]( ctx, step );
	}
}

/**
 * Multi-step interactions with Studio that are awkward to spell out in JSON.
 */
const HELPERS = {
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
		await ctx.w.getByRole( 'button', { name: 'Site menu', exact: true } ).click();
		await ctx.w.getByRole( 'menuitem', { name: 'Delete site' } ).waitFor();
	},

	/**
	 * Opens a site menu submenu and waits for one of its items. The site menu is
	 * reopened first: while another submenu is open, it blocks hovering the rest
	 * of the menu.
	 */
	async openSubmenu( ctx, trigger, item ) {
		await HELPERS.openSiteMenu( ctx );
		const submenu = ctx.w.getByRole( 'menuitem', { name: trigger, exact: true } );
		await submenu.hover();
		const target = ctx.w.getByRole( 'menuitem', { name: item, exact: true } );
		await target.waitFor( { timeout: 2_000 } ).catch( async () => {
			await submenu.click();
			await target.waitFor();
		} );
	},

	/**
	 * Clicks the element matching a CSS selector inside the site preview, which
	 * is a <webview> that locators can't reach, at its centre on screen.
	 */
	async clickInPreview( { w }, selector ) {
		const point = await w.evaluate( async ( sel ) => {
			const view = document.querySelector( 'webview' );
			const frame = view.getBoundingClientRect();
			const inner = await view.executeJavaScript( `(() => {
				const el = document.querySelector( ${ JSON.stringify( sel ) } );
				if ( ! el ) return null;
				el.scrollIntoView( { block: 'center' } );
				const box = el.getBoundingClientRect();
				return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			})()` );
			return inner && { x: frame.x + inner.x, y: frame.y + inner.y };
		}, selector );
		if ( ! point ) {
			throw new Error( `Nothing in the site preview matches ${ selector }` );
		}
		await w.mouse.click( point.x, point.y );
	},

	/** Types into whatever has focus, such as a field inside the site preview. */
	async typeText( { w }, text ) {
		await w.keyboard.type( text );
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

	/** Undoes unsaved site settings so later shots start clean. */
	async discardSettings( { w } ) {
		const discard = w.getByRole( 'button', { name: 'Discard' } );
		if ( await discard.count() ) {
			await discard.click();
			await discard.waitFor( { state: 'hidden' } );
		}
	},
};
