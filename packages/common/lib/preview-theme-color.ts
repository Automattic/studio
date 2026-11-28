// This function is serialized into preview pages, so it must stay self-contained.
export function observePreviewThemeColor( report: ( color: string | null ) => void ): () => void {
	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = 1;
	const context = canvas.getContext( '2d', { willReadFrequently: true } );
	if ( document.contentType !== 'text/html' || ! context ) {
		report( null );
		return () => {};
	}

	let frame = 0;
	let previous: string | null | undefined;
	let media: MediaQueryList[] = [];
	const schedule = () => {
		if ( ! frame ) frame = requestAnimationFrame( update );
	};
	const update = () => {
		frame = 0;
		for ( const query of media ) query.removeEventListener( 'change', schedule );
		media = [];
		let color: string | null = null;
		for ( const element of document.querySelectorAll( 'meta[name][content]' ) ) {
			if ( element.getAttribute( 'name' )?.toLowerCase() !== 'theme-color' ) continue;
			const condition = element.getAttribute( 'media' );
			if ( condition ) {
				const query = matchMedia( condition );
				query.addEventListener( 'change', schedule );
				media.push( query );
				if ( ! query.matches ) continue;
			}
			const value = element.getAttribute( 'content' )?.trim() ?? '';
			context.fillStyle = '#010203';
			context.fillStyle = value;
			const first = context.fillStyle;
			context.fillStyle = '#040506';
			context.fillStyle = value;
			if ( first !== context.fillStyle ) continue;
			context.clearRect( 0, 0, 1, 1 );
			context.fillRect( 0, 0, 1, 1 );
			const channels = context.getImageData( 0, 0, 1, 1 ).data;
			color = `#${ Array.from( channels )
				.slice( 0, 3 )
				.map( ( channel ) => channel.toString( 16 ).padStart( 2, '0' ) )
				.join( '' ) }`;
			break;
		}
		if ( color !== previous ) {
			previous = color;
			report( color );
		}
	};

	const observer = new MutationObserver( schedule );
	if ( document.head ) {
		observer.observe( document.head, {
			attributes: true,
			attributeFilter: [ 'name', 'content', 'media' ],
			childList: true,
			subtree: true,
		} );
	}
	schedule();
	return () => {
		if ( frame ) cancelAnimationFrame( frame );
		observer.disconnect();
		for ( const query of media ) query.removeEventListener( 'change', schedule );
	};
}
