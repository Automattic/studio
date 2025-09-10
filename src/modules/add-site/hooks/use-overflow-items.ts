import { useLayoutEffect, useState, useRef, useCallback } from 'react';

// Constants for layout calculations
const ITEM_SPACING = 12; // Gap between category items in pixels
const MORE_BUTTON_WIDTH = 70; // Estimated width of "+X more" button in pixels
const DEBOUNCE_DELAY = 50; // Delay in milliseconds for debounced recalculation
const TOLERANCE = 10; // Extra pixels to account for measurement precision

export function useOverflowItems( items: string[], containerRef: React.RefObject< HTMLElement > ) {
	const [ visibleCount, setVisibleCount ] = useState( items.length );
	const itemRefs = useRef< ( HTMLElement | null )[] >( [] );
	const lastWidth = useRef( 0 );
	const debounceTimeout = useRef< NodeJS.Timeout | null >( null );

	const calculate = useCallback( () => {
		if ( ! containerRef.current || items.length === 0 ) {
			return;
		}

		const container = containerRef.current;
		const containerWidth = container.offsetWidth;

		if ( containerWidth === 0 || containerWidth === lastWidth.current ) {
			return;
		}

		lastWidth.current = containerWidth;

		let totalWidth = 0;
		let count = 0;

		for ( let i = 0; i < itemRefs.current.length; i++ ) {
			const item = itemRefs.current[ i ];
			if ( ! item ) continue;

			const itemWidth = item.offsetWidth;
			const spacing = i > 0 ? ITEM_SPACING : 0;
			const moreButtonSpace = i < items.length - 1 ? MORE_BUTTON_WIDTH : 0;

			if ( totalWidth + spacing + itemWidth + moreButtonSpace <= containerWidth ) {
				totalWidth += spacing + itemWidth;
				count = i + 1;
			} else {
				break;
			}
		}

		if ( count === items.length - 1 && itemRefs.current[ items.length - 1 ] ) {
			const lastItem = itemRefs.current[ items.length - 1 ];
			const lastItemWidth = lastItem?.offsetWidth || 0;
			if ( totalWidth + ITEM_SPACING + lastItemWidth <= containerWidth + TOLERANCE ) {
				count = items.length;
			}
		}

		setVisibleCount( Math.max( 1, count ) );
	}, [ items, containerRef ] );

	useLayoutEffect( () => {
		if ( debounceTimeout.current ) {
			clearTimeout( debounceTimeout.current );
		}
		debounceTimeout.current = setTimeout( calculate, DEBOUNCE_DELAY );
		return () => {
			if ( debounceTimeout.current ) {
				clearTimeout( debounceTimeout.current );
			}
		};
	}, [ calculate ] );

	return {
		visible: items.slice( 0, visibleCount ),
		hidden: items.slice( visibleCount ),
		hiddenCount: items.length - visibleCount,
		itemRefs,
	};
}
