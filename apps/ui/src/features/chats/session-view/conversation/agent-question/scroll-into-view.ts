const QUESTION_SCROLL_TOP_MARGIN_PX = 12;
// Only a pre-layout fallback. The scroller spans the full column with the
// composer floating over it, so the space to actually keep clear is the
// scroller's reserved bottom padding, which tracks the live composer height.
const QUESTION_SCROLL_BOTTOM_CLEARANCE_PX = 96;

function getNearestScrollContainer( element: HTMLElement ): HTMLElement | null {
	let parent = element.parentElement;
	while ( parent ) {
		const style = window.getComputedStyle( parent );
		const overflow = `${ style.overflow } ${ style.overflowY }`;
		if ( /(auto|scroll|overlay)/.test( overflow ) && parent.scrollHeight > parent.clientHeight ) {
			return parent;
		}
		parent = parent.parentElement;
	}
	return null;
}

function getPaddingBottom( element: HTMLElement ): number {
	const paddingBottom = parseFloat( window.getComputedStyle( element ).paddingBottom );
	return Number.isFinite( paddingBottom ) ? paddingBottom : 0;
}

function getReservedBottomSpace( element: HTMLElement, container: HTMLElement | null ): number {
	if ( ! container ) {
		return QUESTION_SCROLL_BOTTOM_CLEARANCE_PX;
	}
	// The scroller's padding holds content clear of the floating composer; the
	// column's own trailing space keeps the card from settling flush against it.
	let column = element;
	while ( column.parentElement && column.parentElement !== container ) {
		column = column.parentElement;
	}
	return getPaddingBottom( container ) + getPaddingBottom( column );
}

export function getQuestionScrollDelta( {
	elementTop,
	elementBottom,
	containerTop,
	containerBottom,
	reservedBottomSpace,
}: {
	elementTop: number;
	elementBottom: number;
	containerTop: number;
	containerBottom: number;
	reservedBottomSpace: number;
} ): number {
	const topOverflow = elementTop - ( containerTop + QUESTION_SCROLL_TOP_MARGIN_PX );
	const bottomOverflow = elementBottom - ( containerBottom - reservedBottomSpace );
	return topOverflow < 0 ? topOverflow : Math.max( bottomOverflow, 0 );
}

export function scrollElementIntoViewIfNeeded(
	element: HTMLElement,
	prefersReducedMotion: boolean
) {
	const container = getNearestScrollContainer( element );
	const elementRect = element.getBoundingClientRect();
	const containerRect = container
		? container.getBoundingClientRect()
		: {
				top: 0,
				bottom: window.innerHeight || document.documentElement.clientHeight,
		  };
	const scrollDelta = getQuestionScrollDelta( {
		elementTop: elementRect.top,
		elementBottom: elementRect.bottom,
		containerTop: containerRect.top,
		containerBottom: containerRect.bottom,
		reservedBottomSpace: getReservedBottomSpace( element, container ),
	} );

	if ( scrollDelta !== 0 ) {
		const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';
		if ( container ) {
			container.scrollBy( {
				top: scrollDelta,
				behavior,
			} );
			return;
		}
		window.scrollBy( {
			top: scrollDelta,
			behavior,
		} );
	}
}
