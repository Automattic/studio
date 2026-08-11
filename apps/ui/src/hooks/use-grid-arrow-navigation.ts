import { useCallback } from 'react';

const NAV_KEYS = [ 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End' ];

/**
 * Arrow-key navigation between the items of a card grid (or row). Attach the
 * returned handler to the container's `onKeyDown` and mark each navigable
 * control with `data-arrow-nav-item`.
 *
 * Left/Right move linearly (direction-aware for RTL); Up/Down move by visual
 * row using the container's resolved CSS-grid column count (flex rows resolve
 * to one "column", which degrades to linear movement); Home/End jump to the
 * ends. Tab order is left untouched — arrows are an enhancement on top of it,
 * so overlay controls inside a card wrapper (preview buttons, CTAs) keep
 * their regular tab stops.
 */
export function useGridArrowNavigation() {
	return useCallback( ( event: React.KeyboardEvent< HTMLElement > ) => {
		if ( ! NAV_KEYS.includes( event.key ) ) {
			return;
		}
		const target = event.target as HTMLElement;
		const origin = target.closest< HTMLElement >( '[data-arrow-nav-item]' );
		if ( ! origin ) {
			return;
		}
		const container = event.currentTarget;
		const items = Array.from(
			container.querySelectorAll< HTMLElement >( '[data-arrow-nav-item]' )
		);
		const index = items.indexOf( origin );
		if ( index === -1 ) {
			return;
		}

		const style = getComputedStyle( container );
		const columns =
			style.display === 'grid' && style.gridTemplateColumns !== 'none'
				? style.gridTemplateColumns.split( ' ' ).length
				: 1;
		const isRtl = style.direction === 'rtl';
		const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
		const backward = isRtl ? 'ArrowRight' : 'ArrowLeft';

		let next = -1;
		switch ( event.key ) {
			case forward:
				next = index + 1;
				break;
			case backward:
				next = index - 1;
				break;
			case 'ArrowDown':
				next = index + columns;
				break;
			case 'ArrowUp':
				next = index - columns;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = items.length - 1;
				break;
		}

		if ( next < 0 || next >= items.length || next === index ) {
			return;
		}
		event.preventDefault();
		items[ next ].focus();
	}, [] );
}
