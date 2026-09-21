import type { Page } from 'playwright';

const SLIDESHOW_LIMIT = 4;
const STATE_LIMIT = 24;
const SETTLE_MILLISECONDS = 6_000;
const POLL_MILLISECONDS = 100;

/**
 * Tag slideshows whose only control is a cluster of image-only buttons.
 *
 * A builder that lets a visitor pick a slide from its picture renders one stage
 * state at a time and swaps it on click, so the frozen document keeps whichever
 * state happened to be showing and every other slide survives only as the
 * control's own thumbnail. Recognising the pair is structural — controls that
 * carry a picture and no label, beside a container whose children are mutually
 * exclusive — so any builder's picker is found without naming its classes.
 *
 * Anchors that carry a real destination are excluded. The states are read by
 * clicking, so a link that goes somewhere takes the whole page with it and the
 * route being captured is lost; a picture-only link grid is a thumbnail nav
 * (related posts, a logo wall), not a picker. Same-page hrefs stay eligible,
 * because a genuine picker commonly writes `#` or `#slide-2` and drives the
 * stage from its own handler — the same line `selectable-set-capture` draws
 * between a navigable link and a control.
 */
export function markPagerSlideshows( limit: number ): { index: number; controls: number }[] {
	const isNavigable = ( element: Element ): boolean => {
		if ( element.tagName !== 'A' ) return false;
		const href = ( element.getAttribute( 'href' ) ?? '' ).trim();
		if ( ! href || href === '#' || href.startsWith( '#' ) ) return false;
		if ( href.toLowerCase().startsWith( 'javascript:' ) ) return false;
		return true;
	};
	const isImageOnlyControl = ( element: Element ): boolean =>
		! isNavigable( element ) &&
		( element.textContent ?? '' ).replace( /\u00a0/g, ' ' ).trim() === '' &&
		element.querySelectorAll( 'img' ).length === 1 &&
		( element.querySelector( 'img' )?.getAttribute( 'src' ) ?? '' ) !== '';

	const controls = [ ...document.querySelectorAll< HTMLElement >( 'a, button' ) ].filter(
		isImageOnlyControl
	);
	const groups = new Map< Element, HTMLElement[] >();
	for ( const control of controls ) {
		for ( let node = control.parentElement; node; node = node.parentElement ) {
			const withinNode = controls.filter( ( candidate ) => node!.contains( candidate ) );
			if ( withinNode.length >= 2 ) {
				groups.set( node, withinNode );
				break;
			}
		}
	}

	const visible = ( element: Element ): boolean => {
		const style = getComputedStyle( element );
		return style.display !== 'none' && style.visibility !== 'hidden';
	};
	const isStage = ( element: Element, group: Element ): boolean => {
		if ( element.contains( group ) || group.contains( element ) ) return false;
		const children = [ ...element.children ];
		if ( children.length < 2 ) return false;
		if ( ! children.every( ( child ) => child.querySelectorAll( 'img' ).length > 0 ) ) return false;
		const shown = children.filter( visible );
		return shown.length === 1 && shown.length < children.length;
	};

	const marked: { index: number; controls: number }[] = [];
	let index = 0;
	for ( const [ group, members ] of groups ) {
		if ( index >= limit ) break;
		let stage: Element | null = null;
		for ( let scope = group.parentElement, depth = 0; scope && depth < 6; scope = scope.parentElement, depth++ ) {
			stage = [ ...scope.querySelectorAll( '*' ) ].find( ( candidate ) => isStage( candidate, group ) ) ?? null;
			if ( stage ) break;
		}
		if ( ! stage ) continue;

		( stage as HTMLElement ).dataset.dlaPagerStage = String( index );
		members.forEach( ( control, position ) => {
			control.dataset.dlaPagerControl = `${ index }:${ position }`;
		} );
		marked.push( { index, controls: members.length } );
		index++;
	}

	return marked;
}

/**
 * Replace a stage that renders one state at a time with every state observed
 * through its own controls, so the portable copy carries the whole slideshow
 * rather than the frame it was frozen on.
 */
export function preserveCapturedSlides( { index, slides }: { index: number; slides: string[] } ): void {
	const stage = document.querySelector< HTMLElement >( `[data-dla-pager-stage="${ index }"]` );
	if ( ! stage || slides.length < 2 ) return;

	const fragment = document.createDocumentFragment();
	for ( const [ position, html ] of slides.entries() ) {
		const template = document.createElement( 'template' );
		template.innerHTML = html;
		const slide = template.content.firstElementChild;
		if ( ! slide ) continue;
		slide.setAttribute( 'data-dla-captured-slide', String( position ) );
		if ( slide instanceof HTMLElement ) slide.style.removeProperty( 'display' );
		fragment.append( slide );
	}
	// Appending the fragment empties it, so read the count while it still owns
	// the slides.
	const captured = fragment.childElementCount;
	if ( captured < 2 ) return;

	stage.replaceChildren( fragment );
	stage.dataset.dlaCapturedSlideshow = 'true';
	stage.dataset.dlaCapturedSlideCount = String( captured );
	if ( ! document.getElementById( 'dla-captured-slideshow-css' ) ) {
		const style = document.createElement( 'style' );
		style.id = 'dla-captured-slideshow-css';
		style.textContent =
			'[data-dla-pager-stage]>[data-dla-captured-slide]{display:none!important}' +
			'[data-dla-pager-stage]>[data-dla-captured-slide="0"]{display:block!important}';
		document.head.append( style );
	}
}

function snapshotStage( page: Page, index: number ): Promise< { html: string; key: string } | null > {
	return page.evaluate( ( stageIndex ) => {
		const stage = document.querySelector< HTMLElement >( `[data-dla-pager-stage="${ stageIndex }"]` );
		if ( ! stage ) return null;
		const children = [ ...stage.children ];
		const slide =
			children.find( ( child ) => getComputedStyle( child ).display !== 'none' ) ?? children[ 0 ];
		if ( ! slide ) return null;
		const media = [ ...slide.querySelectorAll< HTMLImageElement >( 'img' ) ].map(
			( image ) => image.currentSrc || image.src
		);
		const text = slide.textContent?.replace( /\s+/g, ' ' ).trim() ?? '';
		return { html: slide.outerHTML, key: `${ text }\n${ media.join( '\n' ) }` };
	}, index );
}

async function waitForStageChange(
	page: Page,
	index: number,
	previousKey: string
): Promise< { html: string; key: string } | null > {
	for ( let elapsed = 0; elapsed < SETTLE_MILLISECONDS; elapsed += POLL_MILLISECONDS ) {
		await page.waitForTimeout( POLL_MILLISECONDS );
		const snapshot = await snapshotStage( page, index );
		if ( snapshot && snapshot.key !== previousKey ) return snapshot;
	}
	return null;
}

export interface PagerSlideshowStates {
	index: number;
	advertised: number;
	states: string[];
	error: string;
}

/**
 * Walk every state a thumbnail picker advertises.
 *
 * Reading the states needs the source's own script still driving the stage, so
 * this runs while the page is live and only reports what it saw. Each state is
 * displayed before it is read, so the media it loads is the full-size image the
 * source serves rather than the control's thumbnail.
 */
export async function collectPagerSlideshowStates( page: Page ): Promise< PagerSlideshowStates[] > {
	const slideshows = await page.evaluate( markPagerSlideshows, SLIDESHOW_LIMIT ).catch( () => [] );
	const collections: PagerSlideshowStates[] = [];
	for ( const { index, controls } of slideshows ) {
		const initial = await snapshotStage( page, index );
		if ( ! initial ) continue;

		const states = [ initial ];
		const seen = new Set( [ initial.key ] );
		let failure = '';
		for ( let position = 0; position < Math.min( controls, STATE_LIMIT ); position++ ) {
			const control = page.locator( `[data-dla-pager-control="${ index }:${ position }"]` );
			try {
				await control.scrollIntoViewIfNeeded();
				await control.click( { timeout: 5_000 } );
			} catch ( error ) {
				failure ||= `slide control could not be activated: ${
					error instanceof Error ? error.message : String( error )
				}`;
				continue;
			}
			const snapshot = await waitForStageChange( page, index, states.at( -1 )!.key );
			if ( ! snapshot || seen.has( snapshot.key ) ) continue;
			seen.add( snapshot.key );
			states.push( snapshot );
		}

		collections.push( {
			index,
			advertised: controls,
			states: states.map( ( state ) => state.html ),
			error: failure,
		} );
	}

	return collections;
}

/**
 * Leave the collected states in the document that is about to be frozen.
 *
 * This is separate from collection because the states have to be read while the
 * source's script is still driving the stage, whereas the document is only
 * rewritten once every measurement that reads the live layout has finished.
 */
export async function applyPagerSlideshowStates(
	page: Page,
	collections: PagerSlideshowStates[]
): Promise< void > {
	for ( const { index, advertised, states, error } of collections ) {
		if ( states.length > 1 ) {
			await page.evaluate( preserveCapturedSlides, { index, slides: states } );
		}
		if ( states.length === advertised && ! error ) continue;

		await page.evaluate(
			( { stageIndex, observed, declared, message } ) => {
				const stage = document.querySelector< HTMLElement >(
					`[data-dla-pager-stage="${ stageIndex }"]`
				);
				if ( ! stage ) return;
				stage.dataset.dlaCapturedSlideCount = String( observed );
				stage.dataset.dlaAdvertisedSlideCount = String( declared );
				if ( message ) stage.dataset.dlaCaptureError = message;
			},
			{ stageIndex: index, observed: states.length, declared: advertised, message: error }
		);
	}
}
