import '@testing-library/jest-dom/vitest';

// jsdom does not implement several browser APIs that the renderer relies on
// unconditionally (it always runs in Electron/browsers). Provide permissive
// defaults so components like DotGrid can mount in tests; individual tests
// still override these when they need to assert on specific behavior.

// matchMedia — e.g. DotGrid reads prefers-reduced-motion / prefers-color-scheme.
if ( typeof window !== 'undefined' && typeof window.matchMedia !== 'function' ) {
	Object.defineProperty( window, 'matchMedia', {
		writable: true,
		configurable: true,
		value: ( query: string ) => ( {
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		} ),
	} );
}

// ResizeObserver — DotGrid observes its canvas to re-measure on layout changes.
if ( typeof globalThis.ResizeObserver === 'undefined' ) {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
}

// Canvas 2D context — jsdom's getContext throws "Not implemented". Return a
// no-op stub so canvas-drawing components (DotGrid) don't crash on mount.
if ( typeof HTMLCanvasElement !== 'undefined' ) {
	const noopContext = {
		clearRect: () => {},
		fillRect: () => {},
		beginPath: () => {},
		moveTo: () => {},
		lineTo: () => {},
		stroke: () => {},
		scale: () => {},
		setLineDash: () => {},
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		globalAlpha: 1,
	};
	HTMLCanvasElement.prototype.getContext = ( () =>
		noopContext ) as unknown as HTMLCanvasElement[ 'getContext' ];
}
