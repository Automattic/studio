import { useLayoutEffect, useRef, useState } from 'react';

/**
 * How the header under the site actions fits them: everything inline, the
 * actions folded into a More menu, or the browser navigation folded in too.
 */
export type SiteHeaderLayout = 'inline' | 'actions-overflow' | 'navigation-overflow';

// The address field's useful width, kept when deciding whether the rest fits.
const ADDRESS_MIN_WIDTH = 320;

const widthOf = ( element: Element | null ) => element?.getBoundingClientRect().width ?? 0;
const pixels = ( value: string ) => parseFloat( value ) || 0;

/**
 * Measures the header that hosts the actions (the one holding `space`) and
 * picks the layout that fits. Expanded widths are retained while controls are
 * folded, so hiding them can't move the breakpoint that caused it.
 */
export function useSiteHeaderLayout( space: HTMLElement | null, actions: HTMLElement | null ) {
	const [ layout, setLayout ] = useState< SiteHeaderLayout >( 'inline' );
	const [ actionsWidth, setActionsWidth ] = useState( 0 );
	// Set when the layout change folds away the focused control.
	const refocus = useRef( false );

	useLayoutEffect( () => {
		const header = space?.closest< HTMLElement >( '[data-site-header]' );
		if ( ! header || ! actions ) {
			return;
		}
		let current: SiteHeaderLayout = 'inline';
		let annotationWidth = 0;
		let navigationWidth = 0;
		const measure = () => {
			const width = header.clientWidth;
			if ( ! width ) {
				return;
			}
			const style = getComputedStyle( header );
			const gap = pixels( style.columnGap );
			const actionGap = pixels( getComputedStyle( actions ).columnGap );
			const navigation = header.querySelector( '[data-site-header-navigation]' );
			const measuredNavigationWidth = widthOf( navigation );
			if ( measuredNavigationWidth > 0 ) {
				navigationWidth = measuredNavigationWidth;
			}
			const annotation = header.querySelector( '[data-site-header-annotate]' );
			const address = header.querySelector( '[data-site-header-address]' );
			const reserved = [ ...header.querySelectorAll( '[data-site-header-reserved]' ) ];
			if ( current === 'inline' ) {
				annotationWidth = widthOf( annotation );
			}
			const available =
				width -
				pixels( style.paddingLeft ) -
				pixels( style.paddingRight ) -
				reserved.reduce(
					( total, element ) =>
						total +
						widthOf( element ) +
						pixels( getComputedStyle( element ).marginInlineEnd ) +
						gap,
					0
				);
			const full =
				widthOf( actions.querySelector( '[data-site-header-publish]' ) ) +
				widthOf( actions.querySelector( '[data-site-header-trailing]' ) ) +
				( annotation ? annotationWidth + actionGap : 0 ) +
				( navigation ? navigationWidth + gap : 0 ) +
				( address ? ADDRESS_MIN_WIDTH + gap : 0 );
			setActionsWidth( widthOf( actions ) );
			let next: SiteHeaderLayout = 'navigation-overflow';
			if ( available >= full ) {
				next = 'inline';
			} else if ( ! navigation ) {
				next = 'actions-overflow';
			}
			if ( next !== current ) {
				const focused = document.activeElement;
				refocus.current = Boolean(
					focused &&
						( actions.querySelector( '[data-site-header-trailing]' )?.contains( focused ) ||
							( next !== 'inline' && focused.closest( '[data-address-action]' ) ) ||
							( next === 'navigation-overflow' && navigation?.contains( focused ) ) )
				);
				current = next;
				setLayout( next );
			}
		};
		const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver( measure );
		resizes?.observe( header );
		resizes?.observe( actions );
		const mutations = new MutationObserver( measure );
		const options = { subtree: true, childList: true, characterData: true, attributes: true };
		mutations.observe( header, options );
		mutations.observe( actions, options );
		setLayout( 'inline' );
		measure();
		return () => {
			resizes?.disconnect();
			mutations.disconnect();
		};
	}, [ actions, space ] );

	// The More menu, or Share once it fits again, takes over from it.
	useLayoutEffect( () => {
		if ( ! refocus.current ) {
			return;
		}
		refocus.current = false;
		[
			...( actions?.querySelectorAll< HTMLElement >( '[data-site-header-trailing] button' ) ?? [] ),
		]
			.find( ( button ) => ! button.closest( '[hidden]' ) )
			?.focus();
	}, [ actions, layout ] );

	return { layout, actionsWidth };
}
