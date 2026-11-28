import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTabThumbnail } from './use-tab-thumbnail';

const toCanvas = vi.hoisted( () => vi.fn() );
vi.mock( 'html-to-image', () => ( { toCanvas } ) );

function preview( content: string ) {
	const viewport = document.createElement( 'div' );
	viewport.dataset.thumbnailTest = '';
	viewport.innerHTML = `<div data-tab-surface>${ content }</div>`;
	document.body.append( viewport );
	return viewport;
}

function size( element: HTMLElement, width: number, height: number, left = 0, top = 0 ) {
	Object.defineProperties( element, {
		clientWidth: { value: width },
		clientHeight: { value: height },
	} );
	element.getBoundingClientRect = () =>
		( { left, top, width, height, right: left + width, bottom: top + height } ) as DOMRect;
}

afterEach( () => {
	document.querySelectorAll( '[data-thumbnail-test]' ).forEach( ( element ) => element.remove() );
	vi.clearAllMocks();
} );

it( 'captures a Studio-rendered email and its nested HTML body', async () => {
	const viewport = preview( '<h2>Email details</h2><iframe title="Email content"></iframe>' );
	const surface = viewport.querySelector< HTMLElement >( '[data-tab-surface]' )!;
	const frame = viewport.querySelector( 'iframe' )!;
	size( surface, 800, 700 );
	size( frame, 400, 300, 400, 100 );
	const context = {
		save() {},
		beginPath() {},
		roundRect() {},
		clip() {},
		drawImage: vi.fn(),
		restore() {},
	};
	toCanvas.mockResolvedValue( {
		width: 480,
		getContext: () => context,
		toDataURL: () => 'data:image/jpeg;base64,email',
	} );
	const onThumbnail = vi.fn();
	renderHook( () => useTabThumbnail( { current: viewport }, '/email', true, onThumbnail, true ) );
	await waitFor( () =>
		expect( onThumbnail ).toHaveBeenCalledWith( '/email', 'data:image/jpeg;base64,email' )
	);
	expect( toCanvas ).toHaveBeenCalledWith( surface, expect.any( Object ) );
	expect( toCanvas ).toHaveBeenCalledWith( frame.contentDocument!.body, expect.any( Object ) );
	expect( context.drawImage ).toHaveBeenCalled();
} );

it( 'captures the visible part of a scrolled design system', async () => {
	const viewport = preview( '<div data-design-surface><div>Design content</div></div>' );
	const design = viewport.querySelector< HTMLElement >( '[data-design-surface]' )!;
	const content = design.firstElementChild!;
	size( design, 800, 700 );
	design.scrollTop = 400;
	Object.defineProperty( content, 'scrollHeight', { value: 1600 } );
	toCanvas.mockResolvedValue( { width: 480, toDataURL: () => 'data:image/jpeg;base64,design' } );
	const onThumbnail = vi.fn();
	renderHook( () => useTabThumbnail( { current: viewport }, '/design', true, onThumbnail, true ) );
	await waitFor( () =>
		expect( onThumbnail ).toHaveBeenCalledWith( '/design', 'data:image/jpeg;base64,design' )
	);
	expect( toCanvas ).toHaveBeenCalledWith(
		content,
		expect.objectContaining( {
			style: { height: '1600px', transform: 'translateY(-400px)' },
		} )
	);
} );
