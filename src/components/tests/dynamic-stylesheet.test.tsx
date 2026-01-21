import { render, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DynamicStylesheet } from 'src/components/dynamic-stylesheet';

describe( 'DynamicStylesheet', () => {
	beforeEach( () => {
		const existingLinks = document.head.querySelectorAll( 'link[id]' );
		existingLinks.forEach( ( link ) => link.remove() );
	} );

	afterEach( () => {
		cleanup();
		const existingLinks = document.head.querySelectorAll( 'link[id]' );
		existingLinks.forEach( ( link ) => link.remove() );
	} );

	it( 'should create a link element with correct attributes when mounted', () => {
		render( <DynamicStylesheet id="test-style" href="/test.css" /> );

		const linkElement = document.getElementById( 'test-style' ) as HTMLLinkElement;
		expect( linkElement ).toBeInTheDocument();
		expect( linkElement.tagName ).toBe( 'LINK' );
		expect( linkElement.rel ).toBe( 'stylesheet' );
		expect( linkElement.type ).toBe( 'text/css' );
		expect( linkElement.href ).toBe( 'http://localhost:3000/test.css' );
	} );

	it( 'should update href when href prop changes', () => {
		const { rerender } = render( <DynamicStylesheet id="test-style" href="/test.css" /> );

		let linkElement = document.getElementById( 'test-style' ) as HTMLLinkElement;
		expect( linkElement.href ).toBe( 'http://localhost:3000/test.css' );

		// Update the href prop
		rerender( <DynamicStylesheet id="test-style" href="/updated.css" /> );

		linkElement = document.getElementById( 'test-style' ) as HTMLLinkElement;
		expect( linkElement.href ).toBe( 'http://localhost:3000/updated.css' );
	} );

	it( 'should maintain element order when href changes', () => {
		const { rerender: rerender1 } = render(
			<DynamicStylesheet id="first-style" href="/first.css" />
		);
		render( <DynamicStylesheet id="second-style" href="/second.css" /> );

		// Get initial order (new elements are inserted before existing ones)
		const allLinks = document.head.querySelectorAll( 'link[id]' );
		const initialOrder = Array.from( allLinks ).map( ( link ) => link.id );
		expect( initialOrder ).toEqual( [ 'second-style', 'first-style' ] );

		// Update href of the first element
		rerender1( <DynamicStylesheet id="first-style" href="/first-updated.css" /> );

		// Order should be preserved
		const allLinksAfterUpdate = document.head.querySelectorAll( 'link[id]' );
		const orderAfterUpdate = Array.from( allLinksAfterUpdate ).map( ( link ) => link.id );
		expect( orderAfterUpdate ).toEqual( [ 'second-style', 'first-style' ] );

		// Verify the href was actually updated
		const firstElement = document.getElementById( 'first-style' ) as HTMLLinkElement;
		expect( firstElement.href ).toBe( 'http://localhost:3000/first-updated.css' );
	} );

	it( 'should reuse existing link element with same id and not remove it on unmount', () => {
		// Manually create a link element with the same id
		const existingLink = document.createElement( 'link' );
		existingLink.id = 'existing-style';
		existingLink.rel = 'stylesheet';
		existingLink.href = '/existing.css';
		document.head.appendChild( existingLink );

		const { unmount } = render( <DynamicStylesheet id="existing-style" href="/new.css" /> );

		// Should still be the same element (not a new one)
		const linkElement = document.getElementById( 'existing-style' ) as HTMLLinkElement;
		expect( linkElement ).toBe( existingLink );
		expect( linkElement.href ).toBe( 'http://localhost:3000/new.css' );

		// Unmount component - element should NOT be removed since we didn't create it
		unmount();

		// Element should still exist since it wasn't created by the component
		expect( document.getElementById( 'existing-style' ) ).toBeInTheDocument();
		expect( linkElement.href ).toBe( 'http://localhost:3000/new.css' );
	} );

	it( 'should handle multiple DynamicStylesheet components with different ids', () => {
		render(
			<>
				<DynamicStylesheet id="style-1" href="/style1.css" />
				<DynamicStylesheet id="style-2" href="/style2.css" />
				<DynamicStylesheet id="style-3" href="/style3.css" />
			</>
		);

		const link1 = document.getElementById( 'style-1' ) as HTMLLinkElement;
		const link2 = document.getElementById( 'style-2' ) as HTMLLinkElement;
		const link3 = document.getElementById( 'style-3' ) as HTMLLinkElement;

		expect( link1 ).toBeInTheDocument();
		expect( link2 ).toBeInTheDocument();
		expect( link3 ).toBeInTheDocument();
		expect( link1.href ).toBe( 'http://localhost:3000/style1.css' );
		expect( link2.href ).toBe( 'http://localhost:3000/style2.css' );
		expect( link3.href ).toBe( 'http://localhost:3000/style3.css' );
	} );

	it( 'should render null and not affect DOM tree', () => {
		const { container } = render( <DynamicStylesheet id="test-style" href="/test.css" /> );

		// Component should render nothing in the React tree
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'should handle href with query parameters and cache busting', () => {
		const timestamp = Date.now();
		const href = `/main.css?v=${ timestamp }`;

		render( <DynamicStylesheet id="cache-busted-style" href={ href } /> );

		const linkElement = document.getElementById( 'cache-busted-style' ) as HTMLLinkElement;
		expect( linkElement.href ).toBe( `http://localhost:3000/main.css?v=${ timestamp }` );
	} );

	it( 'should handle multiple stylesheet updates', () => {
		const { rerender } = render(
			<DynamicStylesheet id="wp-components" href="/styles/wp-components.css" />
		);

		let linkElement = document.getElementById( 'wp-components' ) as HTMLLinkElement;
		expect( linkElement.href ).toBe( 'http://localhost:3000/styles/wp-components.css' );

		// Switch to RTL
		rerender( <DynamicStylesheet id="wp-components" href="/styles/wp-components-rtl.css" /> );

		linkElement = document.getElementById( 'wp-components' ) as HTMLLinkElement;
		expect( linkElement.href ).toBe( 'http://localhost:3000/styles/wp-components-rtl.css' );

		// Switch back to LTR
		rerender( <DynamicStylesheet id="wp-components" href="/styles/wp-components.css" /> );

		linkElement = document.getElementById( 'wp-components' ) as HTMLLinkElement;
		expect( linkElement.href ).toBe( 'http://localhost:3000/styles/wp-components.css' );
	} );

	it( 'should remove the link element when component unmounts', () => {
		const { unmount } = render( <DynamicStylesheet id="test-style" href="/test.css" /> );
		expect( document.getElementById( 'test-style' ) ).toBeInTheDocument();
		unmount();
		expect( document.getElementById( 'test-style' ) ).not.toBeInTheDocument();
	} );

	it( 'should remove the link element after updating the href and unmounting', () => {
		const { rerender, unmount } = render( <DynamicStylesheet id="test-style" href="/test.css" /> );
		expect( document.getElementById( 'test-style' ) ).toBeInTheDocument();
		rerender( <DynamicStylesheet id="test-style" href="/updated.css" /> );
		expect( ( document.getElementById( 'test-style' ) as HTMLLinkElement ).href ).toBe(
			'http://localhost:3000/updated.css'
		);
		unmount();
		expect( document.getElementById( 'test-style' ) ).not.toBeInTheDocument();
	} );
} );
