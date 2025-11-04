import { useEffect, useRef } from 'react';

interface DynamicStylesheetProps {
	id: string;
	href: string;
}

export const DynamicStylesheet = ( { id, href }: DynamicStylesheetProps ) => {
	const linkElementRef = useRef< HTMLLinkElement | null >( null );

	useEffect( () => {
		let linkElement = document.getElementById( id ) as HTMLLinkElement | null;

		let wasCreatedByUsRef = false;
		if ( ! linkElement ) {
			linkElement = document.createElement( 'link' );
			linkElement.id = id;
			linkElement.rel = 'stylesheet';
			linkElement.type = 'text/css';
			const firstStylesheet =
				document.head.querySelector( 'link[rel="stylesheet"]' ) ||
				document.head.querySelector( 'style' );
			if ( firstStylesheet ) {
				document.head.insertBefore( linkElement, firstStylesheet );
			} else {
				document.head.appendChild( linkElement );
			}
			wasCreatedByUsRef = true;
		}
		linkElementRef.current = linkElement;

		return () => {
			if ( wasCreatedByUsRef && linkElementRef.current && linkElementRef.current.parentNode ) {
				linkElementRef.current.parentNode.removeChild( linkElementRef.current );
			}
		};
	}, [ id ] );

	useEffect( () => {
		if ( linkElementRef.current ) {
			linkElementRef.current.href = href;
		}
	}, [ href ] );

	return null;
};
