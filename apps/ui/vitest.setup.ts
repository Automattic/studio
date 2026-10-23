import '@testing-library/jest-dom/vitest';

// Base UI's switches and checkboxes dispatch PointerEvents, which jsdom lacks.
if ( typeof window !== 'undefined' && ! window.PointerEvent ) {
	window.PointerEvent = MouseEvent as typeof PointerEvent;
}

// jsdom doesn't implement matchMedia, which components call for the color
// scheme and reduced motion. Provide a no-op stub globally.
if ( typeof window !== 'undefined' && ! window.matchMedia ) {
	const noop = () => {};
	Object.defineProperty( window, 'matchMedia', {
		writable: true,
		value: ( query: string ) => ( {
			matches: false,
			media: query,
			onchange: null,
			addListener: noop,
			removeListener: noop,
			addEventListener: noop,
			removeEventListener: noop,
			dispatchEvent: () => false,
		} ),
	} );
}
