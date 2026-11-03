import { useLayoutEffect, useState } from 'react';

/** Fades only the content that can scroll behind a fixed edge. */
export function useScrollFade< T extends HTMLElement >( {
	inset = false,
	stickyHeaders = false,
}: { inset?: boolean; stickyHeaders?: boolean } = {} ) {
	const [ element, setElement ] = useState< T | null >( null );
	useLayoutEffect( () => {
		if ( ! element ) return;
		const measure = () => {
			const style = getComputedStyle( element );
			const size = parseFloat( style.getPropertyValue( '--surface-fade-size' ) ) || 24;
			const top = Math.max( 0, element.scrollTop );
			const bottom = Math.max( 0, element.scrollHeight - element.clientHeight - top );
			const topSize = Math.min( top, inset ? parseFloat( style.paddingTop ) : size );
			const bottomSize = inset
				? parseFloat( style.paddingBottom ) + Math.min( bottom, size )
				: Math.min( bottom, size );
			element.style.setProperty( '--scroll-fade-top', `${ topSize }px` );
			element.style.setProperty( '--scroll-fade-bottom', `${ bottomSize }px` );
			element.style.setProperty( '--scroll-fade-top-inset', '0px' );
			element.style.setProperty(
				'--scroll-fade-bottom-inset',
				`${ Math.max( 0, bottomSize - size ) }px`
			);
			element.toggleAttribute( 'data-scroll-top', top > 1 );
			element.toggleAttribute( 'data-scroll-bottom', bottom > 1 );
			if ( stickyHeaders ) {
				const edge = element.getBoundingClientRect().top;
				for ( const anchor of element.querySelectorAll< HTMLElement >(
					'[data-sticky-fade-anchor]'
				) ) {
					anchor.nextElementSibling?.toggleAttribute(
						'data-stuck',
						anchor.getBoundingClientRect().top < edge
					);
				}
			}
		};
		let frame = 0;
		const schedule = () => {
			cancelAnimationFrame( frame );
			frame = requestAnimationFrame( measure );
		};
		const resize = new ResizeObserver( schedule );
		const observeChildren = () => {
			resize.disconnect();
			resize.observe( element );
			for ( const child of element.children ) resize.observe( child );
		};
		observeChildren();
		const mutation = new MutationObserver( ( records ) => {
			if (
				records.some( ( record ) => record.target === element && record.type === 'childList' )
			) {
				observeChildren();
			}
			schedule();
		} );
		mutation.observe( element, { childList: true, subtree: true, characterData: true } );
		element.addEventListener( 'scroll', schedule, { passive: true } );
		measure();
		return () => {
			cancelAnimationFrame( frame );
			resize.disconnect();
			mutation.disconnect();
			element.removeEventListener( 'scroll', schedule );
		};
	}, [ element, inset, stickyHeaders ] );
	return setElement;
}
