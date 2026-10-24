import { describe, expect, it } from 'vitest';
import { getUnsupportedWpCliOptionMessage } from 'cli/lib/wp-cli-options';

describe( 'getUnsupportedWpCliOptionMessage', () => {
	it( 'names an option written with a typographic dash', () => {
		expect( getUnsupportedWpCliOptionMessage( [ 'media', 'import', 'a.png', '–porcelain' ] ) ).toBe(
			'Unsupported WP-CLI option "–porcelain": use ASCII hyphens, for example "--porcelain", not a typographic dash.'
		);
	} );

	it( 'accepts ASCII options and dashes inside values', () => {
		expect(
			getUnsupportedWpCliOptionMessage( [
				'post',
				'create',
				'--post_title=Ember – Oak',
				'--porcelain',
			] )
		).toBeNull();
	} );
} );
