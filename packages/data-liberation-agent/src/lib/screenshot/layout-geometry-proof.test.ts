import { describe, expect, it } from 'vitest';
import { buildLayoutGeometryProof } from './layout-geometry-proof.js';

const html = '<main><div><section>Copy</section></div></main>';
const identityHtml = html
	.replace( '<div>', '<div data-dla-geometry-id="wrapper-0">' )
	.replace( '<section>', '<section data-dla-geometry-id="target-0">' );
const observation = ( viewport: number ) => ( {
	wrapperIdentity: 'wrapper-0',
	targetIdentity: 'target-0',
	viewport,
	state: 'default' as const,
	wrapper: { x: 0, y: 0, width: 100, height: 24 },
	target: { x: 0, y: 0, width: 100, height: 24 },
	simulated: { x: 0, y: 0, width: 100, height: 24 },
	facts: { display: 'block', position: 'static', visibility: 'visible', childCount: 1 },
	invariants: { runtime: true, semantics: true },
} );

describe( 'buildLayoutGeometryProof', () => {
	it( 'is deterministic across source order and preserves desktop/mobile boxes', () => {
		const input = { sourcePath: 'website/index.html', html, identityHtml, observations: [ observation( 1440 ), observation( 390 ) ] };
		const first = buildLayoutGeometryProof( [ input ] );
		const second = buildLayoutGeometryProof( [ { ...input, observations: [ observation( 390 ), observation( 1440 ) ] } ] );
		expect( first.proof ).toEqual( second.proof );
		expect( ( first.proof as { nodes: Array<{ boxes: unknown[] }> } ).nodes[ 0 ].boxes ).toHaveLength( 2 );
	} );

	it( 'resolves nested wrapper and target identities without overwriting either identity', () => {
		const nestedHtml = '<main><div><div><section>Copy</section></div></div></main>';
		const nestedIdentityHtml = nestedHtml
			.replace( '<div><div>', '<div data-dla-geometry-id="wrapper-0"><div data-dla-geometry-id="target-0 wrapper-1">' )
			.replace( '<section>', '<section data-dla-geometry-id="target-1">' );
		const proof = buildLayoutGeometryProof( [ {
			sourcePath: 'website/index.html',
			html: nestedHtml,
			identityHtml: nestedIdentityHtml,
			observations: [
				observation( 1440 ),
				{ ...observation( 1440 ), wrapperIdentity: 'wrapper-1', targetIdentity: 'target-1' },
			],
		} ] );
		expect( ( proof.proof as { reductions: unknown[]; nodes: unknown[] } ).reductions ).toHaveLength( 2 );
		expect( ( proof.proof as { reductions: unknown[]; nodes: unknown[] } ).nodes ).toHaveLength( 3 );
		expect( proof.report.omissions ).toEqual( {} );
	} );

	it( 'omits missing selectors, stale resume observations, and out-of-bounds candidates', () => {
		const missing = buildLayoutGeometryProof( [ { sourcePath: 'website/index.html', html, identityHtml: html, observations: [ observation( 1440 ) ] } ] );
		expect( missing.proof ).toBeUndefined();
		expect( missing.report.omissions ).toMatchObject( { source_node_missing: 1 } );

		const stale = buildLayoutGeometryProof( [ { sourcePath: 'website/index.html', html, identityHtml, observations: [ { ...observation( 1440 ), simulated: { x: 2, y: 0, width: 100, height: 24 } } ] } ] );
		expect( stale.proof ).toBeUndefined();
		expect( stale.report.omissions ).toMatchObject( { geometry_or_invariant_unproven: 1 } );

		const bounded = buildLayoutGeometryProof( [ { sourcePath: 'website/index.html', html, identityHtml, observations: Array.from( { length: 9 }, ( _, index ) => observation( index + 1 ) ) } ] );
		expect( bounded.proof ).toBeUndefined();
		expect( bounded.report.omissions ).toMatchObject( { viewport_bounds_invalid: 1 } );
	} );
} );
