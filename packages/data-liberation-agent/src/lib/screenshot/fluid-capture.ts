// src/lib/screenshot/fluid-capture.ts
//
// Drive the width sweep that `fluid-model` learns from.
//
// The source's own runtime is left running while the viewport changes, so what
// we record is the site telling us how it sizes itself. The learned CSS then
// replaces the runtime-written inline pixels, which is what lets the liberated
// copy keep reflowing after that runtime is stripped.
//
import {
	breakpointsFrom,
	learnFluidModel,
	learnSegmentedFluidModel,
	learnWidestFluidModel,
	segmentedCss,
	type FluidModel,
	type GeometrySample,
} from './fluid-model.js';
import type { Page } from 'playwright';

/** Marks elements across viewport changes; removed before serialization. */
const ID_ATTRIBUTE = 'data-dla-fluid-id';
/** Keys segmented stylesheet rules to their element; survives serialization. */
const SEGMENT_ATTRIBUTE = 'data-dla-fluid-segment';
/** Marks the stylesheet block carrying segmented rules as capture-owned. */
export const SEGMENT_STYLE_ATTRIBUTE = 'data-dla-fluid-rules';
/** Attribute pattern used by the exporter to recognize those blocks. */
export const FLUID_RULES_STYLE_ATTRIBUTE = /\bdata-dla-fluid-rules\b/i;
/** Only geometry that a runtime plausibly derives from viewport width. */
const LEARNABLE_PROPERTIES = [ 'width', 'height', 'top', 'font-size', 'padding-top' ] as const;

export type LearnableProperty = ( typeof LEARNABLE_PROPERTIES )[ number ];

export interface FluidSweepOptions {
	/** Widths to observe. More widths cost time but sharpen the fit. */
	widths?: number[];
	/** Settle time after each resize, for the runtime to react. */
	settleMs?: number;
	onProgress?: ( ( width: number, elements: number ) => void ) | undefined;
}

export interface FluidLearningResult {
	/** Elements whose inline geometry was replaced with a learned expression. */
	applied: number;
	/** Elements observed but left frozen because no model fit. */
	unmodelled: number;
	/** Widths where some element changed its sizing rule. */
	breakpoints: number[];
	/**
	 * Width at which this document stops shrinking — the widest floor among
	 * learned `max(floor, k*vw)` models. Below it the layout overflows rather
	 * than adapting, which makes it the source's own switching point.
	 */
	canvasFloor: number | null;
	byKind: Record< string, number >;
}

/** Default ladder: mobile, canvas, and wide, spanning common real viewports.
 *
 * The mobile widths matter: a source that obeys one rule above its mobile
 * breakpoint and another below it (container share changes, different clamp)
 * is unmodelled — or worse, mis-modelled — when every sample sits above the
 * switch. */
export const DEFAULT_SWEEP_WIDTHS = [ 390, 600, 768, 1024, 1280, 1440, 1920 ];

/**
 * Observe inline geometry across widths, fit a model per element and property,
 * and write the learned CSS back into the live DOM.
 *
 * Returns without touching the page when nothing carries runtime-written
 * geometry, so a purely declarative site pays only the sweep.
 */
export async function learnAndApplyFluidGeometry(
	page: Page,
	options: FluidSweepOptions = {}
): Promise< FluidLearningResult > {
	const widths = options.widths ?? DEFAULT_SWEEP_WIDTHS;
	const settleMs = options.settleMs ?? 1200;
	const original = page.viewportSize();

	const tagged = await page.evaluate(
		( { attribute } ) => {
			let index = 0;
			for ( const element of document.querySelectorAll< HTMLElement >( '[style]' ) ) {
			// Only elements a runtime sized in pixels are candidates.
			const style = element.getAttribute( 'style' ) ?? '';
			const carriesPixelSize = /\b(?:width|height|font-size|padding-top)\s*:\s*\d/.test( style );
				const carriesCapturedAnchorTop =
					element.hasAttribute( 'data-dla-anchor-target' ) && /\btop\s*:\s*\d/.test( style );
				if ( ! carriesPixelSize && ! carriesCapturedAnchorTop ) continue;
				element.setAttribute( attribute, String( index++ ) );
			}
			return index;
		},
		{ attribute: ID_ATTRIBUTE }
	);

	if ( tagged === 0 ) {
		return { applied: 0, unmodelled: 0, breakpoints: [], canvasFloor: null, byKind: {} };
	}

	// key: `${id}:${property}` -> observations across widths
	const observations = new Map< string, GeometrySample[] >();

	for ( const width of widths ) {
		await page.setViewportSize( { width, height: original?.height ?? 900 } );
		await page.waitForTimeout( settleMs );
		// Lazy content that has not loaded reports no geometry, which would
		// teach the fitter from holes. Scroll the page to settle it first.
		await page.evaluate( async () => {
			const step = window.innerHeight;
			for ( let y = 0; y < document.documentElement.scrollHeight; y += step ) {
				window.scrollTo( 0, y );
				await new Promise( ( resolve ) => setTimeout( resolve, 60 ) );
			}
			window.scrollTo( 0, 0 );
		} );
		// The copy renders at rest — what a reader at the top of the page
		// sees — so the samples must be taken there too. Scroll-linked chrome
		// (a header that shrinks once the page has been scrolled) re-expands
		// on the way back to the top on its own schedule; a fixed delay either
		// races it or wastes time. Wait for the geometry actually being
		// measured to go quiet instead.
		await waitForRestGeometry( page, ID_ATTRIBUTE );

		const measured = await page.evaluate(
			( { attribute, properties } ) =>
				[ ...document.querySelectorAll< HTMLElement >( `[${ attribute }]` ) ].map( ( element ) => {
					const style = element.getAttribute( 'style' ) ?? '';
					const values: Record< string, number | null > = {};
					const containers: Record< string, number | null > = {};
					const parent = element.parentElement;
					for ( const property of properties ) {
						// `top` is a position against a containing block, not a
						// share of a parent's box, so it has no container fit.
						// `font-size` is excluded too: CSS resolves a font
						// percentage against the parent font size, not its width,
						// and container-query units assume the exported copy
						// reflows the parent box the way the source did — which a
						// canvas/grid layout frozen into static flow does not.
						// `padding-top` is excluded as well: its percentage
						// resolves against the containing block's width, which
						// the sweep does not observe on the vertical axis.
						containers[ property ] =
							parent && property !== 'top' && property !== 'font-size' && property !== 'padding-top'
							? property === 'width'
								? parent.clientWidth
								: parent.clientHeight
							: null;
					}
					for ( const property of properties ) {
						if ( property === 'top' && ! element.hasAttribute( 'data-dla-anchor-target' ) ) {
							values[ property ] = null;
							continue;
						}
						if ( property === 'top' ) {
							const sourceId = element.getAttribute( 'data-dla-anchor-source-id' );
							const source = sourceId ? document.getElementById( sourceId ) : null;
							// A sticky/fixed source reports the current viewport edge, not
							// the document destination the anchor observed. In that case
							// retain the marker's measured document coordinate.
							if (
								source &&
								! source.closest( 'header,[role="banner"]' ) &&
								! [ 'fixed', 'sticky' ].includes( getComputedStyle( source ).position )
							) {
								values[ property ] = source.getBoundingClientRect().top + window.scrollY;
								continue;
							}
						}
						const match = new RegExp( `(?:^|;)\\s*${ property }\\s*:\\s*(\\d+(?:\\.\\d+)?)px` ).exec( style );
						values[ property ] = match ? Number( match[ 1 ] ) : null;
					}
					return { id: element.getAttribute( attribute )!, values, containers };
				} ),
			{ attribute: ID_ATTRIBUTE, properties: LEARNABLE_PROPERTIES as unknown as string[] }
		);

		for ( const entry of measured ) {
			for ( const property of LEARNABLE_PROPERTIES ) {
				const value = entry.values[ property ];
				if ( value === null || value === undefined ) continue;
				const key = `${ entry.id }:${ property }`;
				const list = observations.get( key ) ?? [];
				list.push( { viewport: width, value, container: entry.containers?.[ property ] ?? null } );
				observations.set( key, list );
			}
		}
		options.onProgress?.( width, measured.length );
	}

	const learned: Array< {
		id: string;
		property: string;
		css: string;
		fallbackCss: string | null;
		/** Media-scoped rules replace the inline declaration entirely. */
		segmentedCss: string | null;
	} > = [];
	const byKind: Record< string, number > = {};
	const breakpoints = new Set< number >();
	let canvasFloor: number | null = null;
	let unmodelled = 0;

	for ( const [ key, samples ] of observations ) {
		const [ id, property ] = key.split( ':' ) as [ string, LearnableProperty ];
		const wholeRangeModel = learnFluidModel( samples );
		const model: FluidModel = learnWidestFluidModel( samples );
		byKind[ model.kind ] = ( byKind[ model.kind ] ?? 0 ) + 1;
		if ( wholeRangeModel.kind === 'breakpoint' ) {
			for ( const width of breakpointsFrom( wholeRangeModel.samples ) ) breakpoints.add( width );
		}
		// A single relationship may fit no single stretch of the sampled range
		// yet still be recoverable piecewise: sources routinely obey one rule
		// above their mobile breakpoint and another below it. Where every
		// segment fits a viewport-expressible model, ship media-scoped rules
		// instead of freezing.
		const segmented =
			model.kind === 'breakpoint' ? learnSegmentedFluidModel( samples ) : null;
		if ( segmented !== null ) {
			byKind[ model.kind ] = Math.max( 0, ( byKind[ model.kind ] ?? 0 ) - 1 );
			byKind.segmented = ( byKind.segmented ?? 0 ) + 1;
			for ( const segment of segmented.segments ) {
				if ( segment.minWidth !== null ) breakpoints.add( segment.minWidth );
			}
			learned.push( {
				id,
				property,
				css: '',
				fallbackCss: null,
				segmentedCss: segmentedCss(
					`[${ SEGMENT_ATTRIBUTE }="${ id }"]`,
					property,
					segmented.segments
				),
			} );
			continue;
		}
		if ( model.kind === 'breakpoint' ) {
			// Leaving the frozen value is the honest outcome: a wrong formula
			// would be worse than an admittedly fixed one.
			unmodelled++;
			continue;
		}
		if ( model.kind === 'floored' && property === 'width' ) {
			canvasFloor = Math.max( canvasFloor ?? 0, model.floor );
		}
		// A percentage only resolves against a parent that has a definite size on
		// that axis. Carry the viewport fit so a container model that collapses
		// can fall back to the previous behaviour instead of to nothing.
		let fallbackCss: string | null = null;
		if ( model.kind === 'container' ) {
			const viewportOnly = learnWidestFluidModel(
				samples.map( ( sample ) => ( { viewport: sample.viewport, value: sample.value } ) )
			);
			if ( viewportOnly.kind !== 'breakpoint' ) fallbackCss = viewportOnly.css;
		}
		// A captured runtime can give a parent a definite height that disappears
		// when its scripts are removed. A viewport fit keeps a learned height
		// definite in the static document instead of collapsing to 0px.
		const css = property === 'height' && fallbackCss !== null ? fallbackCss : model.css;
		learned.push( { id, property, css, fallbackCss, segmentedCss: null } );
	}

	// Restore the capture viewport BEFORE writing the learned CSS. Returning to
	// the original width makes the source's runtime recompute one last time, and
	// it would overwrite anything applied beforehand with pixels again.
	if ( original ) await page.setViewportSize( original );
	await page.waitForTimeout( settleMs );

	const reverted = await page.evaluate(
		( { attribute, segmentAttribute, entries } ) => {
			let revertedCount = 0;
			for ( const entry of entries ) {
				const element = document.querySelector< HTMLElement >( `[${ attribute }="${ entry.id }"]` );
				if ( ! element ) continue;
				if ( entry.segmentedCss !== null ) {
					// The rules live in a stylesheet keyed by the persistent
					// attribute, so the runtime's inline pixels must go — an
					// inline declaration would outrank them at every width.
					element.setAttribute( segmentAttribute, entry.id );
					element.style.removeProperty( entry.property );
					continue;
				}
				const axis = entry.property === 'height' ? 'height' : 'width';
				const before = element.getBoundingClientRect()[ axis ];
				element.style.setProperty( entry.property, entry.css );
				if ( entry.fallbackCss === null ) continue;

				// Verify rather than assume: a parent with no definite size on
				// this axis collapses the percentage, which would be a worse
				// copy than the viewport units it replaced.
				const after = element.getBoundingClientRect()[ axis ];
				if ( after > 1 || before <= 1 ) continue;
				element.style.setProperty( entry.property, entry.fallbackCss );
				entry.css = entry.fallbackCss;
				revertedCount++;
			}
			// A source resize callback can still mutate inline styles after learning
			// completes. Keep the learned declaration authoritative until serialization;
			// this observer itself is not part of the exported document.
			const authoritative = entries.flatMap( ( entry ) => {
				const element = document.querySelector< HTMLElement >( `[${ attribute }="${ entry.id }"]` );
				return element ? [ { element, property: entry.property, css: entry.css, segmented: entry.segmentedCss !== null } ] : [];
			} );
			const observer = new MutationObserver( () => {
				for ( const entry of authoritative ) {
					const current = entry.element.style.getPropertyValue( entry.property );
					if ( entry.segmented ) {
						// The stylesheet rule is the declaration; any inline pixels
						// the runtime rewrites would outrank it.
						if ( current !== '' ) entry.element.style.removeProperty( entry.property );
						continue;
					}
					if ( current === entry.css ) continue;
					entry.element.style.setProperty( entry.property, entry.css );
				}
			} );
			observer.observe( document.documentElement, { subtree: true, attributes: true, attributeFilter: [ 'style' ] } );
			return revertedCount;
		},
		{ attribute: ID_ATTRIBUTE, segmentAttribute: SEGMENT_ATTRIBUTE, entries: learned }
	);

	const segmentedRules = learned
		.map( ( entry ) => entry.segmentedCss )
		.filter( ( css ): css is string => css !== null );
	if ( segmentedRules.length > 0 ) {
		await page.evaluate(
			( { styleAttribute, rules } ) => {
				const style = document.createElement( 'style' );
				style.setAttribute( styleAttribute, '' );
				style.textContent = rules.join( '\n' );
				document.head.appendChild( style );
			},
			{ styleAttribute: SEGMENT_STYLE_ATTRIBUTE, rules: segmentedRules }
		);
	}

	await page.evaluate(
		( { attribute } ) => {
			for ( const element of document.querySelectorAll( `[${ attribute }]` ) ) {
				element.removeAttribute( attribute );
			}
		},
		{ attribute: ID_ATTRIBUTE }
	);

	if ( reverted > 0 ) {
		byKind.container = Math.max( 0, ( byKind.container ?? 0 ) - reverted );
		byKind.proportional = ( byKind.proportional ?? 0 ) + reverted;
	}

	return {
		applied: learned.length,
		unmodelled,
		breakpoints: [ ...breakpoints ].sort( ( a, b ) => a - b ),
		canvasFloor,
		byKind,
	};
}

/**
 * Wait until the runtime stops rewriting the inline styles being measured.
 *
 * Scroll-linked chrome (a header that shrinks once the page is scrolled)
 * re-expands after the sweep returns to the top on the source's own schedule,
 * and the runtime rewrites the geometry that depends on it as it goes.
 * Sampling mid-transition teaches the fitter the scrolled state, which is not
 * the state the copy renders. Watch exactly what is sampled: four consecutive
 * identical reads, one second apart in total, count as rest. The bound keeps a
 * perpetually animating page from stalling the sweep.
 */
async function waitForRestGeometry( page: Page, attribute: string ): Promise< void > {
	await page.evaluate( async ( { attribute } ) => {
		const snapshot = () =>
			[ ...document.querySelectorAll( `[${ attribute }]` ) ]
				.map( ( element ) => element.getAttribute( 'style' ) ?? '' )
				.join( '\n' );
		const deadline = Date.now() + 3500;
		let previous = snapshot();
		let quiet = 0;
		while ( Date.now() < deadline && quiet < 4 ) {
			await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
			const current = snapshot();
			quiet = current === previous ? quiet + 1 : 0;
			previous = current;
		}
	}, { attribute } );
}
