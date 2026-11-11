import { useLayoutEffect, useRef, useState } from 'react';

export type SiteHeaderLayout = 'inline' | 'mobile-overflow';

const widthOf = ( element: Element | null ) => element?.getBoundingClientRect().width ?? 0;

/** The main header reserves its actions; the browser row fits its own controls. */
export function useSiteHeaderLayout(
	actions: HTMLElement | null,
	browserHeader: HTMLElement | null
) {
	const [ layout, setLayout ] = useState< SiteHeaderLayout >( 'inline' );
	const [ actionsWidth, setActionsWidth ] = useState( 0 );
	const refocus = useRef( false );

	useLayoutEffect( () => {
		if ( ! actions ) return;
		const measure = () => setActionsWidth( widthOf( actions ) );
		const resizes = new ResizeObserver( measure );
		resizes.observe( actions );
		measure();
		return () => {
			resizes.disconnect();
		};
	}, [ actions ] );

	useLayoutEffect( () => {
		const header = browserHeader;
		if ( ! header ) return;
		let current: SiteHeaderLayout = 'inline';
		const measure = () => {
			if ( ! header.clientWidth ) return;
			const annotation = header.querySelector( '[data-site-header-annotation]' );
			const next: SiteHeaderLayout = header.clientWidth <= 540 ? 'mobile-overflow' : 'inline';
			if ( next !== current ) {
				const focused = document.activeElement;
				refocus.current = Boolean(
					focused && next === 'mobile-overflow' && annotation?.contains( focused )
				);
				current = next;
				setLayout( next );
			}
		};
		const observer = new ResizeObserver( measure );
		observer.observe( header );
		window.addEventListener( 'resize', measure );
		setLayout( 'inline' );
		measure();
		return () => {
			observer.disconnect();
			window.removeEventListener( 'resize', measure );
		};
	}, [ browserHeader ] );

	useLayoutEffect( () => {
		if ( ! refocus.current ) return;
		refocus.current = false;
		(
			browserHeader?.querySelector< HTMLElement >( '[data-preview-browser-options]' ) ??
			actions?.querySelector< HTMLElement >( 'button' )
		)?.focus();
	}, [ actions, browserHeader, layout ] );

	return { layout, actionsWidth };
}
