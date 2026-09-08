import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

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
	wrapperIdentity: string;
	targetIdentity: string;
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
	identityHtml: string;
	observations: GeometryObservation[];
}

interface DocumentGeometry {
	nodes: Array< { node: AnyNode; depth: number } >;
	nodeForSelector: ( selector: string ) => AnyNode | undefined;
	intervalFor: ( node: AnyNode ) => { start: number; end: number } | undefined;
}

interface GeometryCandidate {
	sourcePath: string;
	wrapperIdentity: string;
	targetIdentity: string;
	selector: string;
	targetSelector: string;
	sourceHash: string;
	ordered: GeometryObservation[];
	subtreeStart: number;
	subtreeEnd: number;
	wrapperDepth: number;
	deepestChainImpact: number;
}

function hash( value: string ): string {
	return createHash( 'sha256' ).update( value ).digest( 'hex' );
}

function stableId( sourcePath: string, selector: string ): string {
	return `node-${ hash( `${ sourcePath }\0${ selector }` ).slice( 0, 24 ) }`;
}

function selectorForIdentity( $: cheerio.CheerioAPI, identity: string ): string | undefined {
	try {
		const node = $( `[data-dla-geometry-id~="${ identity }"]` );
		if ( node.length !== 1 ) return undefined;
		const parts: string[] = [];
		let current: AnyNode | null = node[ 0 ];
		while ( current?.type === 'tag' ) {
			const name = current.name;
			if ( name === 'body' ) break;
			const siblings = ( current.parent?.children ?? [] ).filter(
				( sibling ) => sibling.type === 'tag' && sibling.name === name
			);
			const index = siblings.indexOf( current );
			if ( index < 0 ) return undefined;
			parts.unshift( `${ name }:nth-of-type(${ index + 1 })` );
			current = current.parent?.type === 'tag' ? current.parent : null;
		}
		return parts.length > 0 ? parts.join( ' > ' ) : undefined;
	} catch {
		return undefined;
	}
}

function sameBox( left: GeometryBox, right: GeometryBox ): boolean {
	return [ 'x', 'y', 'width', 'height' ].every(
		( key ) => Math.abs( left[ key as keyof GeometryBox ] - right[ key as keyof GeometryBox ] ) <= 1
	);
}

function elementDepth( node: AnyNode ): number {
	let depth = 0;
	let current: AnyNode | null = node;
	while ( current?.type === 'tag' && current.name !== 'body' ) {
		depth++;
		current = current.parent?.type === 'tag' ? current.parent : null;
	}
	return depth;
}

function collectDocumentGeometry( html: string ): DocumentGeometry {
	const $ = cheerio.load( html );
	const intervals = new Map< AnyNode, { start: number; end: number } >();
	let position = 0;
	const visit = ( node: AnyNode ) => {
		const start = position++;
		for ( const child of 'children' in node ? node.children : [] ) visit( child );
		if ( node.type === 'tag' ) intervals.set( node, { start, end: position } );
	};
	visit( $.root()[ 0 ] );
	return {
		nodes: $( '*' )
			.toArray()
			.filter( ( node ): node is AnyNode => node.type === 'tag' )
			.map( ( node ) => ( { node, depth: elementDepth( node ) } ) ),
		nodeForSelector: ( selector ) => $( selector )[ 0 ],
		intervalFor: ( node ) => intervals.get( node ),
	};
}

function overlapsSelectedWrapper(
	selectedWrappers: Array< { start: number; end: number } >,
	wrapper: { start: number; end: number }
): boolean {
	for ( const selected of selectedWrappers ) {
		if (
			( selected.start <= wrapper.start && wrapper.end <= selected.end ) ||
			( wrapper.start <= selected.start && selected.end <= wrapper.end )
		)
			return true;
	}
	return false;
}

/**
 * Accept only measurements that remain valid against the final exported HTML.
 * This sidecar deliberately contains selectors, not browser-only marker attributes.
 */
export function buildLayoutGeometryProof(
	inputs: GeometryInput[] | ( () => Iterable< GeometryInput > )
): {
	proof?: Record< string, unknown >;
	report: Record< string, unknown >;
} {
	const nodes: Array< Record< string, unknown > > = [];
	const nodeIds = new Set< string >();
	const reductions: Array< Record< string, unknown > > = [];
	const candidates: GeometryCandidate[] = [];
	const omissions: Record< string, number > = {};
	const omit = ( code: string ) => ( omissions[ code ] = ( omissions[ code ] ?? 0 ) + 1 );
	const orderedInputs =
		typeof inputs === 'function'
			? inputs()
			: [ ...inputs ].sort( ( left, right ) => left.sourcePath.localeCompare( right.sourcePath ) );

	for ( const input of orderedInputs ) {
		const document = collectDocumentGeometry( input.html );
		const identityDocument = cheerio.load( input.identityHtml );
		const sourceHash = hash( input.html );
		const byPair = new Map< string, GeometryObservation[] >();
		for ( const observation of input.observations ) {
			const key = `${ observation.wrapperIdentity }\0${ observation.targetIdentity }`;
			byPair.set( key, [ ...( byPair.get( key ) ?? [] ), observation ] );
		}
		for ( const [ key, observations ] of [ ...byPair.entries() ].sort( ( left, right ) =>
			left[ 0 ].localeCompare( right[ 0 ] )
		) ) {
			const [ wrapperIdentity, targetIdentity ] = key.split( '\0' );
			const selector = selectorForIdentity( identityDocument, wrapperIdentity );
			const targetSelector = selectorForIdentity( identityDocument, targetIdentity );
			if (
				! selector ||
				! targetSelector ||
				! document.nodeForSelector( selector ) ||
				! document.nodeForSelector( targetSelector )
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
			const ordered = [ ...viewports.values() ].sort(
				( left, right ) => left.viewport - right.viewport
			);
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
			const wrapperNode = document.nodeForSelector( selector );
			const wrapperInterval = wrapperNode && document.intervalFor( wrapperNode );
			if ( ! wrapperNode || ! wrapperInterval ) {
				omit( 'source_node_missing' );
				continue;
			}
			const wrapperDepth = elementDepth( wrapperNode );
			const deepestChainImpact = document.nodes.reduce( ( deepest, { node, depth } ) => {
				let current: AnyNode | null = node;
				while ( current?.type === 'tag' ) {
					if ( current === wrapperNode ) return Math.max( deepest, depth - wrapperDepth + 1 );
					current = current.parent?.type === 'tag' ? current.parent : null;
				}
				return deepest;
			}, 0 );
			candidates.push( {
				sourcePath: input.sourcePath,
				wrapperIdentity,
				targetIdentity,
				selector,
				targetSelector,
				sourceHash,
				ordered,
				subtreeStart: wrapperInterval.start,
				subtreeEnd: wrapperInterval.end,
				wrapperDepth,
				deepestChainImpact,
			} );
		}
	}

	const candidateOrder = ( left: GeometryCandidate, right: GeometryCandidate ) =>
		right.deepestChainImpact - left.deepestChainImpact ||
		right.wrapperDepth - left.wrapperDepth ||
		`${ left.wrapperIdentity }\0${ left.targetIdentity }`.localeCompare(
			`${ right.wrapperIdentity }\0${ right.targetIdentity }`
		);
	const queues = new Map< string, GeometryCandidate[] >();
	for ( const candidate of candidates ) {
		queues.set( candidate.sourcePath, [
			...( queues.get( candidate.sourcePath ) ?? [] ),
			candidate,
		] );
	}
	for ( const queue of queues.values() ) queue.sort( candidateOrder );
	const selected: GeometryCandidate[] = [];
	const selectedWrappersBySource = new Map< string, Array< { start: number; end: number } > >();
	const sourcePaths = [ ...queues.keys() ].sort();
	while ( selected.length < MAX_CANDIDATES ) {
		let progress = false;
		for ( const sourcePath of sourcePaths ) {
			const queue = queues.get( sourcePath )!;
			const selectedWrappers = selectedWrappersBySource.get( sourcePath ) ?? [];
			let candidate = queue.shift();
			while (
				candidate &&
				overlapsSelectedWrapper( selectedWrappers, {
					start: candidate.subtreeStart,
					end: candidate.subtreeEnd,
				} )
			) {
				omit( 'overlapping_reduction_unproven' );
				candidate = queue.shift();
			}
			if ( ! candidate ) continue;
			selectedWrappers.push( { start: candidate.subtreeStart, end: candidate.subtreeEnd } );
			selectedWrappersBySource.set( sourcePath, selectedWrappers );
			selected.push( candidate );
			progress = true;
			if ( selected.length >= MAX_CANDIDATES ) break;
		}
		if ( ! progress ) break;
	}
	for ( const queue of queues.values() ) {
		for ( const _candidate of queue ) omit( 'candidate_limit' );
	}

	for ( const candidate of selected.sort( ( left, right ) =>
		`${ left.sourcePath }\0${ left.wrapperIdentity }\0${ left.targetIdentity }`.localeCompare(
			`${ right.sourcePath }\0${ right.wrapperIdentity }\0${ right.targetIdentity }`
		)
	) ) {
		const wrapper = stableId( candidate.sourcePath, candidate.selector );
		const target = stableId( candidate.sourcePath, candidate.targetSelector );
		const boxesFor = ( box: 'wrapper' | 'target' ) =>
			candidate.ordered.map( ( observation ) => ( {
				viewport: observation.viewport,
				state: observation.state,
				source: observation[ box ],
				simulated: observation.simulated,
			} ) );
		for ( const node of [
			{
				id: wrapper,
				source_path: candidate.sourcePath,
				source_hash: candidate.sourceHash,
				selector: candidate.selector,
				boxes: boxesFor( 'wrapper' ),
			},
			{
				id: target,
				source_path: candidate.sourcePath,
				source_hash: candidate.sourceHash,
				selector: candidate.targetSelector,
				boxes: boxesFor( 'target' ),
			},
		] ) {
			if ( nodeIds.has( node.id ) ) continue;
			nodeIds.add( node.id );
			nodes.push( node );
		}
		reductions.push( {
			wrapper,
			target,
			invariants: { selectors: true, runtime: true, semantics: true, viewports: true },
			corrective_css: {
				declarations: [ { property: 'display', value: candidate.ordered[ 0 ].facts.display } ],
			},
		} );
	}

	return {
		...( reductions.length > 0
			? { proof: { schema: LAYOUT_GEOMETRY_PROOF_SCHEMA, nodes, reductions } }
			: {} ),
		report: {
			schema: LAYOUT_GEOMETRY_PROOF_SCHEMA,
			accepted_reductions: reductions.length,
			omissions,
		},
	};
}
