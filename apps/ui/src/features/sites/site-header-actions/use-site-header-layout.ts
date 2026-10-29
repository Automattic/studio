import { useLayoutEffect, useRef, useState } from 'react';

export type SiteHeaderLayout =
	| 'inline'
	| 'actions-overflow'
	| 'navigation-overflow'
	| 'mobile-overflow';

const ADDRESS_MIN_WIDTH = 320;
const COMPACT_ADDRESS_MIN_WIDTH = 160;
const widthOf = ( element: Element | null ) => element?.getBoundingClientRect().width ?? 0;
const pixels = ( value: string ) => parseFloat( value ) || 0;

/** The main header reserves its actions; the browser row fits its own controls. */
export function useSiteHeaderLayout(
	actions: HTMLElement | null,
	browserSpace: HTMLElement | null
) {
	const [ layout, setLayout ] = useState< SiteHeaderLayout >( 'inline' );
	const [ actionsWidth, setActionsWidth ] = useState( 0 );
	const refocus = useRef( false );

	useLayoutEffect( () => {
		if ( ! actions ) return;
		const measure = () => setActionsWidth( widthOf( actions ) );
		const resizes = new ResizeObserver( measure );
		const mutations = new MutationObserver( measure );
		resizes.observe( actions );
		mutations.observe( actions, { subtree: true, childList: true, attributes: true } );
		measure();
		return () => {
			resizes.disconnect();
			mutations.disconnect();
		};
	}, [ actions ] );

	useLayoutEffect( () => {
		const header = browserSpace?.closest< HTMLElement >( '[data-preview-browser-controls]' );
		if ( ! header ) return;
		let current: SiteHeaderLayout = 'inline';
		let navigationWidth = 0;
		const measure = () => {
			const width = header.clientWidth;
			if ( ! width ) return;
			const style = getComputedStyle( header );
			const gap = pixels( style.columnGap );
			const navigation = header.querySelector( '[data-site-header-navigation]' );
			navigationWidth = Math.max( navigationWidth, widthOf( navigation ) );
			const address = header.querySelector( '[data-site-header-address]' );
			const previewActions = header.querySelector( '[data-preview-actions]' );
			const available = width - pixels( style.paddingLeft ) - pixels( style.paddingRight );
			const full =
				( navigation ? navigationWidth + gap : 0 ) +
				( previewActions ? widthOf( previewActions ) + gap : 0 ) +
				( address ? ADDRESS_MIN_WIDTH : 0 );
			const compact =
				full +
				( pixels( style.getPropertyValue( '--preview-control-size' ) ) || 32 ) +
				gap -
				( address ? ADDRESS_MIN_WIDTH - COMPACT_ADDRESS_MIN_WIDTH : 0 );
			let next: SiteHeaderLayout =
				available >= full
					? 'inline'
					: available >= compact
					? 'actions-overflow'
					: 'navigation-overflow';
			if ( window.innerWidth <= 540 ) next = 'mobile-overflow';
			if ( next !== current ) {
				const focused = document.activeElement;
				refocus.current = Boolean(
					focused &&
						header.contains( focused ) &&
						( focused.closest( '[data-site-header-trailing]' ) ||
							( next !== 'inline' && focused.closest( '[data-address-action]' ) ) ||
							( next === 'navigation-overflow' && navigation?.contains( focused ) ) ||
							( next === 'mobile-overflow' && address?.contains( focused ) ) )
				);
				current = next;
				setLayout( next );
			}
		};
		const resizes = new ResizeObserver( measure );
		const mutations = new MutationObserver( measure );
		resizes.observe( header );
		mutations.observe( header, { subtree: true, childList: true, attributes: true } );
		window.addEventListener( 'resize', measure );
		setLayout( 'inline' );
		measure();
		return () => {
			resizes.disconnect();
			mutations.disconnect();
			window.removeEventListener( 'resize', measure );
		};
	}, [ browserSpace ] );

	useLayoutEffect( () => {
		if ( ! refocus.current ) return;
		refocus.current = false;
		(
			browserSpace?.querySelector< HTMLElement >( 'button' ) ??
			browserSpace?.parentElement?.querySelector< HTMLElement >( '[data-preview-responsive]' ) ??
			actions?.querySelector< HTMLElement >( 'button' )
		)?.focus();
	}, [ actions, browserSpace, layout ] );

	return { layout, actionsWidth };
}
