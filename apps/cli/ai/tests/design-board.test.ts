import { renderDesignBoard } from '../design-board';

const DRAFT = `---
name: Northline Roasters
colors:
  primary: "#c2552b"
  background: "#f4efe6"
typography:
  display:
    fontFamily: Fraunces
---
`;

describe( 'renderDesignBoard', () => {
	it( 'draws the draft and its image, and rejects a draft without design values', () => {
		const html = renderDesignBoard( DRAFT, '/sites/northline/option-1.jpg' );
		expect( html ).toContain( 'Northline Roasters' );
		expect( html ).toContain( '#c2552b' );
		expect( html ).toContain( 'src="/sites/northline/option-1.jpg"' );
		expect( () => renderDesignBoard( '---\ncolors:\n  primary: #c2552b\n---\n' ) ).toThrow(
			'quoted'
		);
	} );
} );
