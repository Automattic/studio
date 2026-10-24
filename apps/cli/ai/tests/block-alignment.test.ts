import { describe, expect, it } from 'vitest';
import { trappedFullWidthNotes } from 'cli/ai/block-alignment';

const group = ( attributes: object, inner: string ) =>
	`<!-- wp:group ${ JSON.stringify( attributes ) } --><div>${ inner }</div><!-- /wp:group -->`;
const cover = '<!-- wp:cover {"align":"full","className":"hero"} --><div></div><!-- /wp:cover -->';
const constrained = { layout: { type: 'constrained' } };

describe( 'trappedFullWidthNotes', () => {
	// [ markup, the block named as the one to free ]
	it.each( [
		// A template whose page content sits in a constrained main: the smoke run's.
		[
			group( { tagName: 'main', ...constrained }, '<!-- wp:post-content /-->' ),
			'core/post-content',
		],
		[
			group( { tagName: 'main', ...constrained }, '<!-- wp:post-content {"align":"full"} /-->' ),
			undefined,
		],
		// A full cover inside a group that is held to the content width.
		[ group( constrained, group( constrained, cover ) ), 'core/group' ],
		[ group( { align: 'full', ...constrained }, cover ), undefined ],
		// The legacy layout that inherits the content width is constrained too.
		[ group( { layout: { inherit: true } }, group( {}, cover ) ), 'core/group' ],
		// A group without a constrained layout passes its width through.
		[ group( constrained, group( { align: 'full' }, group( {}, cover ) ) ), undefined ],
		[ cover, undefined ],
		[ group( constrained, cover ), undefined ],
	] )( '%s frees %s', ( markup, stop ) => {
		const notes = trappedFullWidthNotes( markup );
		expect( notes ).toHaveLength( stop ? 1 : 0 );
		if ( stop ) {
			expect( notes[ 0 ] ).toContain( `Give ${ stop } align full.` );
		}
	} );
} );
