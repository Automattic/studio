import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia, which some @wordpress/components controls
// (e.g. CheckboxControl) call on render. Provide a no-op stub globally.
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
