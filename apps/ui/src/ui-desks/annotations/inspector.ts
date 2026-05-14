export interface AnnotationPayload {
	selector: string;
	displayName: string;
	tag: string;
	nearbyText: string;
	boundingBox: {
		top: number;
		left: number;
		width: number;
		height: number;
	};
	pathname: string;
	url: string;
	timestamp: number;
}

export interface AnnotationInspectorEvent {
	type: 'pick';
	payload?: AnnotationPayload;
}

export const ANNOTATION_INSPECTOR_BRIDGE_PREFIX = '__STUDIO_DESK_ANNOTATION__';

const CLEANUP_KEY = '__studioDeskAnnotationCleanup';
const INSPECTOR_CSS = `
	html.studio-desk-annotate-active,
	html.studio-desk-annotate-active * {
		cursor: crosshair !important;
	}

	.studio-desk-annotate-overlay {
		position: absolute;
		pointer-events: none;
		z-index: 2147483640;
		border: 3px solid #2271b1;
		background: rgba(34, 113, 177, 0.18);
		border-radius: 4px;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.6),
			0 8px 24px rgba(34, 113, 177, 0.35);
		transition:
			top 60ms ease-out,
			left 60ms ease-out,
			width 60ms ease-out,
			height 60ms ease-out;
		box-sizing: border-box;
	}
`;

export function mountInspector(
	doc: Document,
	onPick: ( payload: AnnotationPayload ) => void
): () => void {
	const style = doc.createElement( 'style' );
	style.setAttribute( 'data-studio-desk-annotate', 'true' );
	style.textContent = INSPECTOR_CSS;
	doc.head.appendChild( style );
	doc.documentElement.classList.add( 'studio-desk-annotate-active' );

	const overlay = doc.createElement( 'div' );
	overlay.className = 'studio-desk-annotate-overlay';
	overlay.style.display = 'none';
	doc.body.appendChild( overlay );

	const isInspectable = ( target: EventTarget | null ): target is HTMLElement => {
		if ( ! target ) {
			return false;
		}
		const node = target as Node;
		if ( node.nodeType !== 1 ) {
			return false;
		}
		const element = target as HTMLElement;
		if ( typeof element.closest !== 'function' ) {
			return false;
		}
		return ! element.closest( '.studio-desk-annotate-overlay' );
	};

	const positionOverlay = ( target: HTMLElement ) => {
		const rect = target.getBoundingClientRect();
		const win = doc.defaultView;
		const scrollX = win ? win.scrollX : 0;
		const scrollY = win ? win.scrollY : 0;
		overlay.style.display = 'block';
		overlay.style.top = `${ rect.top + scrollY }px`;
		overlay.style.left = `${ rect.left + scrollX }px`;
		overlay.style.width = `${ rect.width }px`;
		overlay.style.height = `${ rect.height }px`;
	};

	const handleMouseMove = ( event: MouseEvent ) => {
		if ( ! isInspectable( event.target ) ) {
			overlay.style.display = 'none';
			return;
		}
		positionOverlay( event.target );
	};

	const handleClick = ( event: MouseEvent ) => {
		if ( ! isInspectable( event.target ) ) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const target = event.target;
		const rect = target.getBoundingClientRect();
		onPick( {
			selector: buildSelector( target ),
			displayName: displayName( target ),
			tag: target.tagName.toLowerCase(),
			nearbyText: nearbyText( target ),
			boundingBox: {
				top: rect.top,
				left: rect.left,
				width: rect.width,
				height: rect.height,
			},
			pathname: doc.location.pathname,
			url: doc.location.href,
			timestamp: Date.now(),
		} );
	};

	doc.addEventListener( 'mousemove', handleMouseMove, true );
	doc.addEventListener( 'click', handleClick, true );

	return () => {
		doc.removeEventListener( 'mousemove', handleMouseMove, true );
		doc.removeEventListener( 'click', handleClick, true );
		style.remove();
		overlay.remove();
		doc.documentElement.classList.remove( 'studio-desk-annotate-active' );
	};
}

export const ANNOTATION_INSPECTOR_CLEANUP_SCRIPT = `
(() => {
	const cleanup = window[ ${ JSON.stringify( CLEANUP_KEY ) } ];
	if ( typeof cleanup === 'function' ) {
		cleanup();
	}
})();
`;

export const ANNOTATION_INSPECTOR_SCRIPT = `
(() => {
	const BRIDGE_PREFIX = ${ JSON.stringify( ANNOTATION_INSPECTOR_BRIDGE_PREFIX ) };
	const CLEANUP_KEY = ${ JSON.stringify( CLEANUP_KEY ) };
	const previousCleanup = window[ CLEANUP_KEY ];
	if ( typeof previousCleanup === 'function' ) {
		previousCleanup();
	}

	const style = document.createElement( 'style' );
	style.setAttribute( 'data-studio-desk-annotate', 'true' );
	style.textContent = ${ JSON.stringify( INSPECTOR_CSS ) };
	document.head.appendChild( style );
	document.documentElement.classList.add( 'studio-desk-annotate-active' );

	const overlay = document.createElement( 'div' );
	overlay.className = 'studio-desk-annotate-overlay';
	overlay.style.display = 'none';
	document.body.appendChild( overlay );

	function isInspectable( target ) {
		if ( ! target || target.nodeType !== 1 ) {
			return false;
		}
		if ( typeof target.closest !== 'function' ) {
			return false;
		}
		return ! target.closest( '.studio-desk-annotate-overlay' );
	}

	function positionOverlay( target ) {
		const rect = target.getBoundingClientRect();
		overlay.style.display = 'block';
		overlay.style.top = rect.top + window.scrollY + 'px';
		overlay.style.left = rect.left + window.scrollX + 'px';
		overlay.style.width = rect.width + 'px';
		overlay.style.height = rect.height + 'px';
	}

	function handleMouseMove( event ) {
		if ( ! isInspectable( event.target ) ) {
			overlay.style.display = 'none';
			return;
		}
		positionOverlay( event.target );
	}

	function handleClick( event ) {
		if ( ! isInspectable( event.target ) ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const target = event.target;
		const rect = target.getBoundingClientRect();
		const payload = {
			selector: buildSelector( target ),
			displayName: displayName( target ),
			tag: target.tagName.toLowerCase(),
			nearbyText: nearbyText( target ),
			boundingBox: {
				top: rect.top,
				left: rect.left,
				width: rect.width,
				height: rect.height,
			},
			pathname: document.location.pathname,
			url: document.location.href,
			timestamp: Date.now(),
		};
		console.log( BRIDGE_PREFIX + JSON.stringify( { type: 'pick', payload } ) );
	}

	function displayName( element ) {
		if ( element.id ) {
			return '#' + element.id;
		}
		const tag = element.tagName.toLowerCase();
		const className = element.classList.item( 0 );
		return className ? tag + '.' + className : tag;
	}

	function buildSelector( element ) {
		if ( element.id ) {
			return '#' + cssEscape( element.id );
		}
		const parts = [];
		let current = element;
		for ( let depth = 0; depth < 6 && current; depth += 1 ) {
			if ( current === document.body || current === document.documentElement ) {
				break;
			}
			if ( current.id ) {
				parts.unshift( '#' + cssEscape( current.id ) );
				break;
			}
			let part = current.tagName.toLowerCase();
			const classes = Array.from( current.classList ).slice( 0, 3 );
			if ( classes.length > 0 ) {
				part += '.' + classes.map( cssEscape ).join( '.' );
			}
			const parent = current.parentElement;
			if ( parent ) {
				const tag = current.tagName;
				const siblings = Array.from( parent.children ).filter(
					( sibling ) => sibling.tagName === tag
				);
				if ( siblings.length > 1 ) {
					part += ':nth-of-type(' + ( siblings.indexOf( current ) + 1 ) + ')';
				}
			}
			parts.unshift( part );
			current = parent;
		}
		return parts.join( ' > ' );
	}

	function nearbyText( element ) {
		const raw = ( element.textContent || '' ).trim();
		return raw.replace( /\\s+/g, ' ' ).slice( 0, 200 );
	}

	function cssEscape( value ) {
		if ( window.CSS && typeof window.CSS.escape === 'function' ) {
			return window.CSS.escape( value );
		}
		return String( value ).replace( /[^a-zA-Z0-9_-]/g, ( character ) => '\\\\' + character );
	}

	document.addEventListener( 'mousemove', handleMouseMove, true );
	document.addEventListener( 'click', handleClick, true );
	window[ CLEANUP_KEY ] = () => {
		document.removeEventListener( 'mousemove', handleMouseMove, true );
		document.removeEventListener( 'click', handleClick, true );
		style.remove();
		overlay.remove();
		document.documentElement.classList.remove( 'studio-desk-annotate-active' );
		delete window[ CLEANUP_KEY ];
	};
})();
`;

function displayName( element: HTMLElement ): string {
	if ( element.id ) {
		return `#${ element.id }`;
	}
	const tag = element.tagName.toLowerCase();
	const className = element.classList.item( 0 );
	return className ? `${ tag }.${ className }` : tag;
}

function buildSelector( element: HTMLElement ): string {
	if ( element.id ) {
		return `#${ cssEscape( element.id ) }`;
	}

	const parts: string[] = [];
	let current: HTMLElement | null = element;
	for ( let depth = 0; depth < 6 && current; depth += 1 ) {
		if (
			current === current.ownerDocument.body ||
			current === current.ownerDocument.documentElement
		) {
			break;
		}
		if ( current.id ) {
			parts.unshift( `#${ cssEscape( current.id ) }` );
			break;
		}
		let part = current.tagName.toLowerCase();
		const classes = Array.from( current.classList ).slice( 0, 3 );
		if ( classes.length > 0 ) {
			part += `.${ classes.map( cssEscape ).join( '.' ) }`;
		}
		const parent: HTMLElement | null = current.parentElement;
		if ( parent ) {
			const tag = current.tagName;
			const siblings = ( Array.from( parent.children ) as HTMLElement[] ).filter(
				( sibling ) => sibling.tagName === tag
			);
			if ( siblings.length > 1 ) {
				part += `:nth-of-type(${ siblings.indexOf( current ) + 1 })`;
			}
		}
		parts.unshift( part );
		current = parent;
	}
	return parts.join( ' > ' );
}

function nearbyText( element: HTMLElement ): string {
	const raw = ( element.textContent || '' ).trim();
	return raw.replace( /\s+/g, ' ' ).slice( 0, 200 );
}

function cssEscape( value: string ): string {
	if ( typeof CSS !== 'undefined' && CSS.escape ) {
		return CSS.escape( value );
	}
	return value.replace( /[^a-zA-Z0-9_-]/g, ( character ) => `\\${ character }` );
}
