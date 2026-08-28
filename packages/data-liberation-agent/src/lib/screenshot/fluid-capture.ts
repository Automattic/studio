// src/lib/screenshot/fluid-capture.ts
//
// Drive the width sweep that `fluid-model` learns from.
//
// The source's own runtime is left running while the viewport changes, so what
// we record is the site telling us how it sizes itself. The learned CSS then
// replaces the runtime-written inline pixels, which is what lets the liberated
// copy keep reflowing after that runtime is stripped.
//
import { breakpointsFrom, learnFluidModel, type FluidModel, type GeometrySample } from './fluid-model.js';
import type { Page } from 'playwright';

/** Marks elements across viewport changes; removed before serialization. */
const ID_ATTRIBUTE = 'data-dla-fluid-id';
/** Only geometry that a runtime plausibly derives from viewport width. */
const LEARNABLE_PROPERTIES = [ 'width', 'height' ] as const;

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

/** Default ladder: narrow, canvas, and wide, spanning common real viewports. */
export const DEFAULT_SWEEP_WIDTHS = [ 768, 1024, 1280, 1440, 1920 ];

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
				if ( ! /\b(?:width|height)\s*:\s*\d/.test( element.getAttribute( 'style' ) ?? '' ) ) continue;
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
		await page.waitForTimeout( 250 );

		const measured = await page.evaluate(
			( { attribute, properties } ) =>
				[ ...document.querySelectorAll< HTMLElement >( `[${ attribute }]` ) ].map( ( element ) => {
					const style = element.getAttribute( 'style' ) ?? '';
					const values: Record< string, number | null > = {};
					for ( const property of properties ) {
						const match = new RegExp( `(?:^|;)\\s*${ property }\\s*:\\s*(\\d+(?:\\.\\d+)?)px` ).exec( style );
						values[ property ] = match ? Number( match[ 1 ] ) : null;
					}
					return { id: element.getAttribute( attribute )!, values };
				} ),
			{ attribute: ID_ATTRIBUTE, properties: LEARNABLE_PROPERTIES as unknown as string[] }
		);

		for ( const entry of measured ) {
			for ( const property of LEARNABLE_PROPERTIES ) {
				const value = entry.values[ property ];
				if ( value === null || value === undefined ) continue;
				const key = `${ entry.id }:${ property }`;
				const list = observations.get( key ) ?? [];
				list.push( { viewport: width, value } );
				observations.set( key, list );
			}
		}
		options.onProgress?.( width, measured.length );
	}

	const learned: Array< { id: string; property: string; css: string } > = [];
	const byKind: Record< string, number > = {};
	const breakpoints = new Set< number >();
	let canvasFloor: number | null = null;
	let unmodelled = 0;

	for ( const [ key, samples ] of observations ) {
		const [ id, property ] = key.split( ':' ) as [ string, LearnableProperty ];
		const model: FluidModel = learnFluidModel( samples );
		byKind[ model.kind ] = ( byKind[ model.kind ] ?? 0 ) + 1;
		if ( model.kind === 'breakpoint' ) {
			// Leaving the frozen value is the honest outcome: a wrong formula
			// would be worse than an admittedly fixed one.
			unmodelled++;
			// Only the widths where the rule actually changed are breakpoints;
			// every sampled width is not evidence of anything.
			for ( const width of breakpointsFrom( model.samples ) ) breakpoints.add( width );
			continue;
		}
		if ( model.kind === 'floored' && property === 'width' ) {
			canvasFloor = Math.max( canvasFloor ?? 0, model.floor );
		}
		learned.push( { id, property, css: model.css } );
	}

	// Restore the capture viewport BEFORE writing the learned CSS. Returning to
	// the original width makes the source's runtime recompute one last time, and
	// it would overwrite anything applied beforehand with pixels again.
	if ( original ) await page.setViewportSize( original );
	await page.waitForTimeout( settleMs );

	await page.evaluate(
		( { attribute, entries } ) => {
			for ( const entry of entries ) {
				const element = document.querySelector< HTMLElement >( `[${ attribute }="${ entry.id }"]` );
				if ( ! element ) continue;
				element.style.setProperty( entry.property, entry.css );
			}
		},
		{ attribute: ID_ATTRIBUTE, entries: learned }
	);

	await page.evaluate(
		( { attribute } ) => {
			for ( const element of document.querySelectorAll( `[${ attribute }]` ) ) {
				element.removeAttribute( attribute );
			}
		},
		{ attribute: ID_ATTRIBUTE }
	);

	return {
		applied: learned.length,
		unmodelled,
		breakpoints: [ ...breakpoints ].sort( ( a, b ) => a - b ),
		canvasFloor,
		byKind,
	};
}
