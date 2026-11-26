import { configure } from '@testing-library/react';

// Rendering the whole app over the fake connector takes a few seconds on a busy machine.
configure( { asyncUtilTimeout: 5000 } );

// Layout and paint APIs jsdom lacks, which rendering the whole app reaches.
if ( typeof window !== 'undefined' ) {
	window.scrollTo = () => {};
	window.scrollBy = () => {};
	CSS.supports ??= () => false;
	HTMLCanvasElement.prototype.getContext = () => null;
	Element.prototype.scrollIntoView ??= () => {};
}
