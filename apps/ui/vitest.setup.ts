import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement these DOM APIs, but @base-ui/react (menus, tooltips,
// submenus) calls them during pointer interactions. Without the shims the
// click handlers throw and the menu/submenu never opens in tests.
if ( ! Element.prototype.scrollIntoView ) {
	Element.prototype.scrollIntoView = () => {};
}
if ( ! Element.prototype.hasPointerCapture ) {
	Element.prototype.hasPointerCapture = () => false;
}
if ( ! Element.prototype.setPointerCapture ) {
	Element.prototype.setPointerCapture = () => {};
}
if ( ! Element.prototype.releasePointerCapture ) {
	Element.prototype.releasePointerCapture = () => {};
}

// jsdom ships neither, but @base-ui/react (via Floating UI) needs ResizeObserver
// to position popups, and user-event dispatches PointerEvents that base-ui's
// pointer handlers listen for. Without these, submenus open but their items
// never receive a usable click.
if ( typeof globalThis.ResizeObserver === 'undefined' ) {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
if ( typeof globalThis.PointerEvent === 'undefined' ) {
	class PointerEvent extends MouseEvent {
		public pointerId: number;
		public pointerType: string;
		public isPrimary: boolean;
		constructor( type: string, params: PointerEventInit = {} ) {
			super( type, params );
			this.pointerId = params.pointerId ?? 0;
			this.pointerType = params.pointerType ?? 'mouse';
			this.isPrimary = params.isPrimary ?? true;
		}
	}
	globalThis.PointerEvent = PointerEvent as typeof globalThis.PointerEvent;
}
