import { useLayoutEffect, useState } from 'react';

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
 * picks the layout that fits. Labeled widths are remembered while inline, so
 * compacting a button can't move the breakpoint it caused.
 */
export function useSiteHeaderLayout( space: HTMLElement | null, actions: HTMLElement | null ) {
	const [ layout, setLayout ] = useState< SiteHeaderLayout >( 'inline' );
	const [ actionsWidth, setActionsWidth ] = useState( 0 );

	useLayoutEffect( () => {
		const header = space?.closest< HTMLElement >( '[data-site-header]' );
		if ( ! header || ! actions ) {
			return;
		}
		let current: SiteHeaderLayout = 'inline';
		let lifecycleWidth = 0;
		let annotationWidth = 0;
		const measure = () => {
			const width = header.clientWidth;
			if ( ! width ) {
				return;
			}
			const style = getComputedStyle( header );
			const gap = pixels( style.columnGap );
			const actionGap = pixels( getComputedStyle( actions ).columnGap );
			const navigation = header.querySelector( '[data-site-header-navigation]' );
			const annotation = header.querySelector( '[data-site-header-annotate]' );
			const address = header.querySelector( '[data-site-header-address]' );
			const reserved = [ ...header.querySelectorAll( '[data-site-header-reserved]' ) ];
			const lifecycle = actions.querySelector( '[data-site-header-lifecycle]' );
			if ( current === 'inline' ) {
				lifecycleWidth = widthOf( lifecycle );
				annotationWidth = widthOf( annotation );
			}
			const available =
				width -
				pixels( style.paddingLeft ) -
				pixels( style.paddingRight ) -
				reserved.reduce( ( total, element ) => total + widthOf( element ) + gap, 0 );
			const full =
				widthOf( actions.querySelector( '[data-site-header-publish]' ) ) +
				widthOf( actions.querySelector( '[data-site-header-trailing]' ) ) +
				( lifecycle ? lifecycleWidth + actionGap : 0 ) +
				( annotation ? annotationWidth + actionGap : 0 ) +
				( navigation ? widthOf( navigation ) + gap : 0 ) +
				( address ? ADDRESS_MIN_WIDTH + gap : 0 );
			setActionsWidth( widthOf( actions ) );
			let next: SiteHeaderLayout = 'navigation-overflow';
			if ( available >= full ) {
				next = 'inline';
			} else if ( ! navigation ) {
				next = 'actions-overflow';
			}
			if ( next !== current ) {
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

	return { layout, actionsWidth };
}
