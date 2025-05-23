import { useCallback, useEffect, useRef } from 'react';

const stylesheets = {
	wpLtr: '/main_window/styles/wordpress-components-style.css',
	wpRtl: '/main_window/styles/wordpress-components-style-rtl.css',
	main: '/main_window.css',
};

function appendStylesheetLink( href: string ) {
	const link = document.createElement( 'link' );
	link.rel = 'stylesheet';
	link.href = href;
	document.head.appendChild( link );
	return link;
}

export function useStylesheets() {
	const stylesheetsRefs = useRef< HTMLLinkElement[] >( [] );

	const removeStylesheets = useCallback( () => {
		stylesheetsRefs.current.forEach( ( link ) => {
			document.head.removeChild( link );
		} );
		stylesheetsRefs.current = [];
	}, [] );

	const loadStylesheets = useCallback(
		( { isRTL }: { isRTL: boolean } ) => {
			console.log( 'loadStylesheet', { isRTL } );
			removeStylesheets();
			const wpLink = appendStylesheetLink( stylesheets[ isRTL ? 'wpRtl' : 'wpLtr' ] );
			const mainLink = appendStylesheetLink( stylesheets.main );
			stylesheetsRefs.current = [ wpLink, mainLink ];
		},
		[ removeStylesheets ]
	);

	useEffect( () => {
		loadStylesheets( { isRTL: false } );
		return removeStylesheets;
	}, [ loadStylesheets, removeStylesheets ] );

	return loadStylesheets;
}
