// This function is serialized into preview pages, so it must stay self-contained.
export function observePreviewThemeColor( report: ( color: string | null ) => void ): () => void {
	if ( document.contentType !== 'text/html' ) {
		report( null );
		return () => {};
	}

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = 1;
	const context = canvas.getContext( '2d', { willReadFrequently: true } );
	if ( ! context ) {
		report( null );
		return () => {};
	}

	type Color = [ number, number, number, number ];
	const parse = ( value: string ): Color | null => {
		context.fillStyle = '#010203';
		context.fillStyle = value;
		const first = context.fillStyle;
		context.fillStyle = '#040506';
		context.fillStyle = value;
		if ( first !== context.fillStyle ) return null;
		context.clearRect( 0, 0, 1, 1 );
		context.fillRect( 0, 0, 1, 1 );
		const [ r, g, b, a ] = context.getImageData( 0, 0, 1, 1 ).data;
		return [ r, g, b, a / 255 ];
	};
	const toHex = ( color: Color ) =>
		`#${ color
			.slice( 0, 3 )
			.map( ( channel ) => Math.round( channel ).toString( 16 ).padStart( 2, '0' ) )
			.join( '' ) }`;
	const over = ( top: Color, bottom: Color ): Color => {
		const alpha = top[ 3 ] + bottom[ 3 ] * ( 1 - top[ 3 ] );
		if ( alpha === 0 ) return [ 0, 0, 0, 0 ];
		return [
			( top[ 0 ] * top[ 3 ] + bottom[ 0 ] * bottom[ 3 ] * ( 1 - top[ 3 ] ) ) / alpha,
			( top[ 1 ] * top[ 3 ] + bottom[ 1 ] * bottom[ 3 ] * ( 1 - top[ 3 ] ) ) / alpha,
			( top[ 2 ] * top[ 3 ] + bottom[ 2 ] * bottom[ 3 ] * ( 1 - top[ 3 ] ) ) / alpha,
			alpha,
		];
	};

	let frame = 0;
	let stopped = false;
	let previous: string | null | undefined;
	let manifestKey = '';
	let manifestColor: Color | null = null;
	let manifestRequest: AbortController | null = null;
	let manifestPending = false;
	let media: MediaQueryList[] = [];
	const schedule = () => {
		if ( ! stopped && ! frame ) frame = requestAnimationFrame( update );
	};
	const headObserver = new MutationObserver( schedule );
	const pageObserver = new MutationObserver( schedule );
	const sizeObserver = new ResizeObserver( schedule );
	let observedElements: Element[] = [];
	let observedBody: HTMLElement | null = null;

	const sampleTop = (): Color | null => {
		const width = document.documentElement.clientWidth;
		if ( ! width ) return null;
		const colors: string[] = [];
		const watched = new Set< Element >( [ document.documentElement ] );
		if ( document.body ) watched.add( document.body );
		for ( const position of [ 0.1, 0.3, 0.5, 0.7, 0.9 ] ) {
			let element = document.elementFromPoint( Math.max( 0, width * position ), 1 );
			let composite: Color = [ 0, 0, 0, 0 ];
			let reliable = true;
			// Ancestor selectors can change an opaque element's background too.
			while ( element ) {
				watched.add( element );
				if ( reliable && composite[ 3 ] < 0.999 ) {
					const style = getComputedStyle( element );
					if (
						style.backgroundImage !== 'none' ||
						Number( style.opacity ) < 1 ||
						/^(IMG|VIDEO|CANVAS|IFRAME|SVG)$/.test( element.tagName )
					) {
						reliable = false;
					} else {
						const background = parse( style.backgroundColor );
						if ( background ) composite = over( composite, background );
					}
				}
				element = element.parentElement;
			}
			if ( reliable && composite[ 3 ] >= 0.999 ) colors.push( toHex( composite ) );
		}
		const elements = Array.from( watched ).slice( 0, 32 );
		if (
			observedBody !== document.body ||
			elements.length !== observedElements.length ||
			elements.some( ( element, index ) => element !== observedElements[ index ] )
		) {
			observedBody = document.body;
			observedElements = elements;
			pageObserver.disconnect();
			sizeObserver.disconnect();
			if ( document.body ) pageObserver.observe( document.body, { childList: true } );
			for ( const element of elements ) {
				pageObserver.observe( element, {
					attributes: true,
					attributeFilter: [ 'class', 'style', 'hidden' ],
					childList: true,
				} );
				sizeObserver.observe( element );
			}
		}
		const mostCommon = colors.find(
			( color ) => colors.filter( ( item ) => item === color ).length >= 3
		);
		return mostCommon ? parse( mostCommon ) : null;
	};

	const readMeta = (): Color | null => {
		for ( const query of media ) query.removeEventListener( 'change', schedule );
		media = [];
		for ( const element of document.querySelectorAll( 'meta[name][content]' ) ) {
			if ( element.getAttribute( 'name' )?.toLowerCase() !== 'theme-color' ) continue;
			const condition = element.getAttribute( 'media' );
			if ( condition ) {
				const query = matchMedia( condition );
				query.addEventListener( 'change', schedule );
				media.push( query );
				if ( ! query.matches ) continue;
			}
			const color = parse( element.getAttribute( 'content' )?.trim() ?? '' );
			if ( color ) return color;
		}
		return null;
	};

	const readManifest = () => {
		const link = Array.from(
			document.querySelectorAll< HTMLLinkElement >( 'link[rel][href]' )
		).find( ( element ) => element.rel.toLowerCase().split( /\s+/ ).includes( 'manifest' ) );
		const key = link ? `${ link.href }|${ link.crossOrigin }` : '';
		if ( key === manifestKey ) return manifestPending ? undefined : manifestColor;
		manifestRequest?.abort();
		manifestKey = key;
		manifestColor = null;
		manifestPending = false;
		if ( ! link ) return null;
		const controller = new AbortController();
		manifestRequest = controller;
		manifestPending = true;
		const timeout = setTimeout( () => controller.abort(), 2000 );
		void fetch( link.href, {
			mode: 'cors',
			credentials: link.crossOrigin === 'use-credentials' ? 'include' : 'same-origin',
			signal: controller.signal,
		} )
			.then( ( response ) => ( response.ok ? response.text() : '' ) )
			.then( ( text ) => {
				if ( stopped || controller.signal.aborted || text.length > 65536 ) return;
				const manifest = JSON.parse( text ) as { theme_color?: unknown };
				manifestColor =
					typeof manifest.theme_color === 'string' ? parse( manifest.theme_color ) : null;
			} )
			.catch( () => {} )
			.finally( () => {
				clearTimeout( timeout );
				if ( ! stopped && manifestRequest === controller ) {
					manifestPending = false;
					schedule();
				}
			} );
		return undefined;
	};

	function update() {
		frame = 0;
		if ( stopped ) return;
		const top = sampleTop();
		const meta = readMeta();
		const manifest = meta ? null : readManifest();
		if ( ! meta && manifest === undefined ) return;
		const selected = meta ?? manifest ?? top;
		const opaque = selected && selected[ 3 ] < 1 && top ? over( selected, top ) : selected;
		const color = opaque && opaque[ 3 ] >= 0.999 ? toHex( opaque ) : null;
		if ( color !== previous ) {
			previous = color;
			report( color );
		}
	}

	if ( document.head ) {
		headObserver.observe( document.head, {
			attributes: true,
			attributeFilter: [ 'name', 'content', 'media', 'rel', 'href', 'crossorigin' ],
			childList: true,
			subtree: true,
		} );
	}
	window.addEventListener( 'resize', schedule );
	window.addEventListener( 'load', schedule );
	window.addEventListener( 'pageshow', schedule );
	schedule();
	return () => {
		stopped = true;
		if ( frame ) cancelAnimationFrame( frame );
		manifestRequest?.abort();
		headObserver.disconnect();
		pageObserver.disconnect();
		sizeObserver.disconnect();
		for ( const query of media ) query.removeEventListener( 'change', schedule );
		window.removeEventListener( 'resize', schedule );
		window.removeEventListener( 'load', schedule );
		window.removeEventListener( 'pageshow', schedule );
	};
}
