import { describe, expect, it } from 'vitest';
import { capturedJsonLd } from './json-ld-metadata.js';

describe( 'capturedJsonLd', () => {
	it( 'retains arbitrary parsed JSON-LD with source and alias provenance', () => {
		expect( capturedJsonLd( '<link rel="canonical" href="/canonical"><meta property="og:url" content="/shared"><script type="application/ld+json">{"@context":{"schema":"https://schema.org/"},"@graph":[{"@id":"#organization","@type":"Organization","member":{"@id":"#person"}},{"@id":"#person","@type":["Person","Thing"]}]}</script>', 'https://example.com/captured' ) ).toEqual( {
			source_url: 'https://example.com/captured',
			aliases: { canonical: 'https://example.com/canonical', open_graph: 'https://example.com/shared' },
			objects: [ { '@context': { schema: 'https://schema.org/' }, '@graph': [ { '@id': '#organization', '@type': 'Organization', member: { '@id': '#person' } }, { '@id': '#person', '@type': [ 'Person', 'Thing' ] } ] } ],
			diagnostics: [],
		} );
	} );

	it( 'reports malformed and oversize scripts without retaining executable source', () => {
		const oversized = JSON.stringify( { description: 'x'.repeat( 64 * 1024 ) } );
		const result = capturedJsonLd( `<script type="application/ld+json">{bad</script><script type="application/ld+json">${ oversized }</script>`, 'https://example.com/' )!;
		expect( result.objects ).toEqual( [] );
		expect( result.diagnostics ).toEqual( [
			{ code: 'invalid_json', script_index: 0, bytes: 4 },
			{ code: 'oversize', script_index: 1, bytes: Buffer.byteLength( oversized ) },
		] );
	} );
} );
