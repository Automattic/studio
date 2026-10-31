import { useLayoutEffect, useRef, useState } from 'react';

export type SiteHeaderLayout = 'inline' | 'mobile-overflow';

const widthOf = ( element: Element | null ) => element?.getBoundingClientRect().width ?? 0;

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
		const measure = () => {
			const address = header.querySelector( '[data-site-header-address]' );
			const next: SiteHeaderLayout = window.innerWidth <= 540 ? 'mobile-overflow' : 'inline';
			if ( next !== current ) {
				const focused = document.activeElement;
				refocus.current = Boolean(
					focused && next === 'mobile-overflow' && address?.contains( focused )
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
