import { renderDesignBoard } from '../design-board';

const VALID_DESIGN = `---
colors:
  primary: "#c2552b"
  background: "#f7f3ec"
typography:
  heading:
    fontFamily: "Fraunces"
    fontWeight: 600
---

A warm editorial look with terracotta accents.
`;

describe( 'renderDesignBoard', () => {
	it( 'renders a board for a draft with valid front matter', () => {
		const board = renderDesignBoard( VALID_DESIGN );
		expect( board ).toContain( '#c2552b' );
		expect( board ).toContain( 'Fraunces' );
	} );

	it( 'reports a missing opening delimiter when the draft does not start with ---', () => {
		expect( () => renderDesignBoard( 'Just prose, no front matter.' ) ).toThrow(
			'must start with YAML front matter, opening with a --- line'
		);
	} );

	it( 'reports an unclosed front matter block when the closing --- is missing', () => {
		const unclosed = `---
colors:
  primary: "#c2552b"
  background: "#f7f3ec"

A draft that flows straight into prose without closing the YAML block.
`;
		expect( () => renderDesignBoard( unclosed ) ).toThrow(
			'front matter is never closed — end the YAML block with a second --- line'
		);
	} );
} );
