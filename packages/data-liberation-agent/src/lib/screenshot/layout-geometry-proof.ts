import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

export const LAYOUT_GEOMETRY_PROOF_SCHEMA =
	'blocks-engine/php-transformer/layout-geometry-proof/v1';

const MAX_CANDIDATES = 64;
const MAX_VIEWPORTS = 8;

export interface GeometryBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface GeometryObservation {
	selector: string;
	targetSelector: string;
	viewport: number;
	state: 'default';
	wrapper: GeometryBox;
	target: GeometryBox;
	simulated: GeometryBox;
	facts: { display: string; position: string; visibility: string; childCount: number };
	invariants: { runtime: boolean; semantics: boolean };
}

export interface GeometryCapture {
	schema: 'data-liberation/layout-geometry-capture/v1';
	observations: GeometryObservation[];
	omissions: Record< string, number >;
}

interface GeometryInput {
	sourcePath: string;
	html: string;
	observations: GeometryObservation[];
}

function hash( value: string ): string {
	return createHash( 'sha256' ).update( value ).digest( 'hex' );
}

function stableId( sourcePath: string, selector: string ): string {
	return `node-${ hash( `${ sourcePath }\0${ selector }` ).slice( 0, 24 ) }`;
}

function selectorExistsExactlyOnce( html: string, selector: string ): boolean {
	try {
		return cheerio.load( html )( selector ).length === 1;
	} catch {
		return false;
	}
}

function sameBox( left: GeometryBox, right: GeometryBox ): boolean {
	return [ 'x', 'y', 'width', 'height' ].every(
		( key ) => Math.abs( left[ key as keyof GeometryBox ] - right[ key as keyof GeometryBox ] ) <= 1
	);
}

/**
 * Accept only measurements that remain valid against the final exported HTML.
 * This sidecar deliberately contains selectors, not browser-only marker attributes.
 */
export function buildLayoutGeometryProof( inputs: GeometryInput[] ): {
	proof?: Record< string, unknown >;
	report: Record< string, unknown >;
} {
	const nodes: Array< Record< string, unknown > > = [];
	const reductions: Array< Record< string, unknown > > = [];
	const omissions: Record< string, number > = {};
	const omit = ( code: string ) => ( omissions[ code ] = ( omissions[ code ] ?? 0 ) + 1 );

	for ( const input of [ ...inputs ].sort( ( left, right ) => left.sourcePath.localeCompare( right.sourcePath ) ) ) {
		const byPair = new Map< string, GeometryObservation[] >();
		for ( const observation of input.observations ) {
			const key = `${ observation.selector }\0${ observation.targetSelector }`;
			byPair.set( key, [ ...( byPair.get( key ) ?? [] ), observation ] );
		}
		for ( const [ key, observations ] of [ ...byPair.entries() ].sort( ( left, right ) =>
			left[ 0 ].localeCompare( right[ 0 ] )
		) ) {
			if ( reductions.length >= MAX_CANDIDATES ) {
				omit( 'candidate_limit' );
				continue;
			}
			const [ selector, targetSelector ] = key.split( '\0' );
			if (
				! selectorExistsExactlyOnce( input.html, selector ) ||
				! selectorExistsExactlyOnce( input.html, targetSelector )
			) {
				omit( 'source_node_missing' );
				continue;
			}
			const viewports = new Map< number, GeometryObservation >();
			for ( const observation of observations ) {
				if ( viewports.has( observation.viewport ) || observation.state !== 'default' ) {
					omit( 'viewport_state_duplicate' );
					continue;
				}
				viewports.set( observation.viewport, observation );
			}
			if ( viewports.size < 1 || viewports.size > MAX_VIEWPORTS ) {
				omit( 'viewport_bounds_invalid' );
				continue;
			}
			const ordered = [ ...viewports.values() ].sort( ( left, right ) => left.viewport - right.viewport );
			if (
				ordered.some(
					( observation ) =>
						! observation.invariants.runtime ||
						! observation.invariants.semantics ||
						! sameBox( observation.wrapper, observation.target ) ||
						! sameBox( observation.target, observation.simulated )
				)
			) {
				omit( 'geometry_or_invariant_unproven' );
				continue;
			}
			const sourceHash = hash( input.html );
			const wrapper = stableId( input.sourcePath, selector );
			const target = stableId( input.sourcePath, targetSelector );
			const boxesFor = ( box: 'wrapper' | 'target' ) =>
				ordered.map( ( observation ) => ( {
					viewport: observation.viewport,
					state: observation.state,
					source: observation[ box ],
					simulated: observation.simulated,
				} ) );
			nodes.push(
				{ id: wrapper, source_path: input.sourcePath, source_hash: sourceHash, selector, boxes: boxesFor( 'wrapper' ) },
				{ id: target, source_path: input.sourcePath, source_hash: sourceHash, selector: targetSelector, boxes: boxesFor( 'target' ) }
			);
			reductions.push( {
				wrapper,
				target,
				invariants: { selectors: true, runtime: true, semantics: true, viewports: true },
				corrective_css: { declarations: [ { property: 'display', value: ordered[ 0 ].facts.display } ] },
			} );
		}
	}

	return {
		...( reductions.length > 0 ? { proof: { schema: LAYOUT_GEOMETRY_PROOF_SCHEMA, nodes, reductions } } : {} ),
		report: {
			schema: 'data-liberation/layout-geometry-report/v1',
			accepted_reductions: reductions.length,
			omissions,
		},
	};
}
