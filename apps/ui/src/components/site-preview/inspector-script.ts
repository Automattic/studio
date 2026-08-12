/**
 * Annotation inspector injected into the site-preview `<webview>` via
 * `webview.executeJavaScript()`.
 *
 * Runs in the cross-origin guest page so it uses vanilla DOM in a Shadow DOM
 * root — React isn't loaded there. Communicates with the host renderer via a
 * structured `console.log` line that the host receives through the webview's
 * `console-message` event:
 *   guest -> host: `__studio-inspector__:{ "type": "done", ... }`
 *
 * The bridge also reports inspector state and forwards browser shortcuts.
 * Toolbar commands travel in the other direction through a custom event.
 */

export const INSPECTOR_BRIDGE_PREFIX = '__studio-inspector__:';
export const INSPECTOR_COMMAND_EVENT = '__studio-inspector-command';
const INSPECTOR_BRIDGE_TOKEN_PLACEHOLDER = '__STUDIO_INSPECTOR_BRIDGE_TOKEN__';

export function createInspectorPageScript( bridgeToken: string ): string {
	if ( ! /^[a-zA-Z0-9_-]{16,128}$/.test( bridgeToken ) ) {
		throw new Error( 'Invalid inspector bridge token.' );
	}
	return INSPECTOR_PAGE_SCRIPT.replace( INSPECTOR_BRIDGE_TOKEN_PLACEHOLDER, bridgeToken );
}

export const INSPECTOR_PAGE_SCRIPT =
	String.raw`
( () => {
	const BRIDGE_TOKEN = '` +
	INSPECTOR_BRIDGE_TOKEN_PLACEHOLDER +
	String.raw`';
	if ( window.__studioInspectorMounted ) {
		window.dispatchEvent(
			new CustomEvent( '` +
	INSPECTOR_COMMAND_EVENT +
	String.raw`', { detail: { type: 'report-state', bridgeToken: BRIDGE_TOKEN } } )
		);
		return;
	}
	window.__studioInspectorMounted = true;

	const BRIDGE_PREFIX = '` +
	INSPECTOR_BRIDGE_PREFIX +
	String.raw`';
	const COMMAND_EVENT = '` +
	INSPECTOR_COMMAND_EVENT +
	String.raw`';
	const HOST_ID = '__studio-inspector-host';
	const MAX_ANNOTATIONS = 100;

	function send( payload ) {
		try {
			console.log(
				BRIDGE_PREFIX + JSON.stringify( Object.assign( { bridgeToken: BRIDGE_TOKEN }, payload ) )
			);
		} catch ( err ) {
			/* JSON.stringify can fail on cycles; the host treats missing
			 * messages as no-ops, so we swallow rather than crash the page. */
		}
	}

	function isApplePlatform() {
		return /mac|iphone|ipad|ipod/i.test( navigator.platform || navigator.userAgent || '' );
	}

	function isTextEntryTarget( el ) {
		if ( ! el || el.nodeType !== 1 ) return false;
		if ( el.isContentEditable ) return true;
		const tag = el.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select';
	}

	function getBrowserShortcutCommand( event ) {
		if ( event.defaultPrevented || event.repeat ) return null;
		const apple = isApplePlatform();
		if ( event.key === 'ArrowLeft' || event.key === 'ArrowRight' ) {
			/* Layout-independent back/forward aliases: the bracket chords need
			 * Option/AltGr on many European layouts. Skipped while editing text
			 * to keep native caret movement. */
			const hasNavModifier = apple
				? event.metaKey && ! event.ctrlKey && ! event.altKey
				: event.altKey && ! event.ctrlKey && ! event.metaKey;
			if ( ! hasNavModifier || event.shiftKey || isTextEntryTarget( event.target ) ) return null;
			return event.key === 'ArrowLeft' ? 'back' : 'forward';
		}
		if ( event.altKey ) return null;
		const hasPrimaryModifier = apple ? event.metaKey : event.ctrlKey;
		if ( ! hasPrimaryModifier ) return null;
		const key = event.key.toLowerCase();
		/* The host owns full preview, but in that mode this page covers most of
		 * the window — so the chord is caught here and forwarded back. */
		if ( event.shiftKey ) return key === 'f' ? 'full-preview' : null;
		if ( key === 'r' ) return 'reload';
		if ( key === '[' ) return 'back';
		if ( key === ']' ) return 'forward';
		return null;
	}

	function buildSelector( el ) {
		if ( ! el || el.nodeType !== 1 ) return '';
		if ( el.id ) return '#' + CSS.escape( el.id );
		const parts = [];
		let node = el;
		while ( node && node.nodeType === 1 && node !== document.documentElement ) {
			let part = node.tagName.toLowerCase();
			if ( node.classList && node.classList.length ) {
				const classes = Array.from( node.classList )
					.filter( ( c ) => ! c.startsWith( '__studio-' ) )
					.slice( 0, 3 )
					.map( ( c ) => '.' + CSS.escape( c ) )
					.join( '' );
				part += classes;
			}
			const parent = node.parentElement;
			if ( parent ) {
				const sameTagSiblings = Array.from( parent.children ).filter(
					( c ) => c.tagName === node.tagName
				);
				if ( sameTagSiblings.length > 1 ) {
					part += ':nth-of-type(' + ( sameTagSiblings.indexOf( node ) + 1 ) + ')';
				}
			}
			parts.unshift( part );
			node = parent;
			if ( parts.length >= 6 ) break;
		}
		return parts.join( ' > ' );
	}

	function nearbyText( el ) {
		const text = ( el.innerText || el.textContent || '' )
			.replace( /\s+/g, ' ' )
			.trim();
		return text.length > 200 ? text.slice( 0, 200 ) + '…' : text;
	}

	function pickComputedStyles( el ) {
		const cs = window.getComputedStyle( el );
		const keys = [
			'color', 'background-color', 'font-size', 'font-weight',
			'font-family', 'line-height', 'padding', 'margin',
			'border', 'display', 'width', 'height',
		];
		const out = {};
		for ( const k of keys ) {
			out[ k ] = cs.getPropertyValue( k );
		}
		return out;
	}

	function uid() {
		return 'a_' + Math.random().toString( 36 ).slice( 2, 10 );
	}

	function documentRect( el ) {
		const r = el.getBoundingClientRect();
		return {
			left: r.left + window.scrollX,
			top: r.top + window.scrollY,
			width: r.width,
			height: r.height,
		};
	}

	const oldHost = document.getElementById( HOST_ID );
	if ( oldHost ) oldHost.remove();
	const host = document.createElement( 'div' );
	host.id = HOST_ID;
	host.style.cssText =
		'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483647;';
	document.body.appendChild( host );
	const root = host.attachShadow( { mode: 'open' } );

	const style = document.createElement( 'style' );
	style.textContent = ` +
	'`' +
	String.raw`
		:host { all: initial; }
		* { box-sizing: border-box; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
		.highlight, .annotation-highlight {
			position: absolute; pointer-events: none;
			border: 2px solid #2563eb;
			background: rgba(37,99,235,0.1);
			border-radius: 4px;
			box-shadow: 0 0 0 1px rgba(0,0,0,0.9);
		}
		.scrim {
			position: fixed; pointer-events: none;
			background: rgba(0,0,0,0.52);
			z-index: 10;
		}
		.highlight { z-index: 11; }
		.annotation-highlight {
			background: rgba(37,99,235,0.07);
		}
		.marker {
			position: absolute; pointer-events: auto; cursor: pointer;
			z-index: 2;
			width: 22px; height: 22px;
			padding: 0; appearance: none;
			background: #2563eb; color: #fff;
			border: 2px solid #fff;
			border-radius: 50%;
			box-shadow: 0 2px 6px rgba(0,0,0,0.3);
			font: 700 11px/1 inherit;
			display: inline-flex; align-items: center; justify-content: center;
			transform: translate(-50%, -50%);
		}
		.popup {
			--popup-fill: rgba(250,250,250,0.92);
			--popup-tint: rgba(255,255,255,0.04);
			--popup-text: #1e1e1e;
			--popup-text-weak: rgba(30,30,30,0.58);
			position: fixed; width: min(360px, calc(100vw - 16px)); z-index: 12;
			background-color: var(--popup-fill);
			background-image: linear-gradient(var(--popup-tint), var(--popup-tint));
			backdrop-filter: blur(20px) saturate(115%);
			-webkit-backdrop-filter: blur(20px) saturate(115%);
			color: var(--popup-text);
			border: 2px solid #2563eb;
			border-radius: 8px 8px 20px 8px;
			box-shadow: 0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.9);
			padding: 8px 8px 6px;
			pointer-events: auto;
			display: flex; flex-direction: column; gap: 2px;
			will-change: transform;
		}
		.popup.dragging {
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
			will-change: transform;
		}
		.popup .target-row {
			display: flex; align-items: center; justify-content: space-between;
			gap: 6px; min-width: 0;
			cursor: grab; user-select: none;
		}
		.popup .target-row.dragging { cursor: grabbing; }
		.popup .target {
			min-width: 0; max-width: 70%;
			padding: 3px 7px;
			border: 1px solid rgba(30,30,30,0.18);
			border-radius: 6px;
			background: rgba(255,255,255,0.38);
			font: 500 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
			color: var(--popup-text);
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.popup .layer-controls {
			display: inline-flex; align-items: center; flex: none;
			padding: 1px;
			border: 1px solid rgba(30,30,30,0.14);
			border-radius: 7px;
			background: rgba(255,255,255,0.28);
		}
		.popup .layer-button {
			width: 18px; height: 18px; padding: 0;
			border-radius: 5px;
			background: transparent; color: var(--popup-text-weak);
			font-size: 15px; line-height: 1;
		}
		.popup .layer-button:hover { background: rgba(30,30,30,0.08); color: var(--popup-text); }
		.popup .layer-count {
			min-width: 24px; color: var(--popup-text-weak);
			font-size: 10px; text-align: center;
		}
		.popup textarea {
			width: 100%; height: 24px; min-height: 24px; max-height: 100px; resize: none;
			background: transparent; color: var(--popup-text);
			border: 0; border-radius: 0;
			margin-top: 4px; padding: 3px 4px 0; font: 14px/1.3 inherit; outline: none;
		}
		.popup textarea::placeholder { color: var(--popup-text-weak); }
		.popup .actions {
			display: flex; align-items: center; justify-content: flex-end; gap: 4px;
			margin-top: -2px;
		}
		.popup .left-actions { display: inline-flex; align-items: center; margin-right: auto; }
		.popup button {
			padding: 6px 10px; border-radius: 8px; border: none;
			font: 600 12px/1 inherit; cursor: pointer;
		}
		.popup .delete { background: transparent; color: var(--popup-text-weak); }
		.popup .delete:hover { color: #ef4444; }
		.popup .cancel {
			display: inline-flex; align-items: center; height: 28px;
			padding: 0 4px; border-radius: 4px;
			background: transparent; color: var(--popup-text);
			font-size: 11px; font-weight: 500; line-height: 1; opacity: 0.72;
		}
		.popup .cancel:hover { background: rgba(30,30,30,0.08); color: var(--popup-text); }
		.popup .send-to-chat {
			background: rgba(30,30,30,0.08); color: var(--popup-text);
			border-radius: 4px;
			font-size: 11px; font-weight: 600;
		}
		.popup .send-to-chat:hover:not([disabled]) { background: rgba(30,30,30,0.13); }
		.popup .send-to-chat[disabled] { opacity: 0.4; cursor: default; }
		.popup .save {
			display: inline-flex; align-items: center; justify-content: center;
			position: relative;
			width: 28px; height: 28px; padding: 0;
			border-radius: 50%; background: #2563eb; color: #fff;
			font-size: 0;
		}
		.popup .save::before, .popup .save::after {
			content: ''; position: absolute; left: 50%; top: 50%;
			width: 12px; height: 2px; border-radius: 1px;
			background: currentColor; transform: translate(-50%, -50%);
		}
		.popup .save::after { width: 2px; height: 12px; }
		.popup .save:hover:not([disabled]) { filter: brightness(0.92); }
		.popup .save[disabled] { opacity: 0.4; cursor: default; }
		@media (prefers-color-scheme: dark) {
			.highlight, .annotation-highlight {
				box-shadow: 0 0 0 1px rgba(255,255,255,0.9);
			}
			.popup {
				--popup-fill: rgba(20,20,20,0.92);
				--popup-tint: rgba(0,0,0,0.04);
				--popup-text: #f4f4f4;
				--popup-text-weak: rgba(244,244,244,0.58);
				box-shadow: 0 8px 32px rgba(0,0,0,0.42), 0 0 0 1px rgba(255,255,255,0.9);
			}
			.popup .target {
				border-color: rgba(255,255,255,0.2);
				background: rgba(0,0,0,0.2);
			}
			.popup .layer-controls {
				border-color: rgba(255,255,255,0.16);
				background: rgba(0,0,0,0.16);
			}
			.popup .cancel:hover { background: rgba(255,255,255,0.08); }
			.popup .send-to-chat { background: rgba(255,255,255,0.1); }
			.popup .send-to-chat:hover:not([disabled]) { background: rgba(255,255,255,0.16); }
			.popup .layer-button:hover { background: rgba(255,255,255,0.08); }
		}
	` +
	'`' +
	String.raw`;
	root.appendChild( style );

	/* ------------------------------------------------------------------
	 * State + DOM
	 * ---------------------------------------------------------------- */
	let isPicking = false;
	let hoveredEl = null;
	let activePopup = null; /* { id?, target, comment } */
	let annotations = Array.isArray( window.__studioInspectorState )
		? window.__studioInspectorState
				.filter(
					( annotation ) =>
						typeof annotation === 'object' &&
						annotation !== null &&
						typeof annotation.id === 'string' &&
						typeof annotation.comment === 'string' &&
						annotation.comment.trim()
				)
				.slice( 0, MAX_ANNOTATIONS )
		: [];

	const markerNodes = new Map(); /* id -> marker element */
	const annotationHighlightNodes = new Map(); /* id -> highlight element */
	const scrimNodes = [];
	let highlightNode = null;
	let popupNode = null;
	let scrollLock = null;

	function syncScrollLock() {
		if ( activePopup && ! scrollLock ) {
			scrollLock = {
				documentOverflow: document.documentElement.style.overflow,
				bodyOverflow: document.body.style.overflow,
			};
			document.documentElement.style.overflow = 'hidden';
			document.body.style.overflow = 'hidden';
		} else if ( ! activePopup && scrollLock ) {
			document.documentElement.style.overflow = scrollLock.documentOverflow;
			document.body.style.overflow = scrollLock.bodyOverflow;
			scrollLock = null;
		}
	}

	function persistAnnotations() {
		let persistedAnnotations = [];
		try {
			persistedAnnotations = JSON.parse( JSON.stringify( annotations ) );
		} catch {
			persistedAnnotations = [];
		}
		window.__studioInspectorState = persistedAnnotations;
		send( { type: 'annotations-updated', annotations: persistedAnnotations } );
	}

	function sendState() {
		send( {
			type: 'state',
			isPicking,
			annotationCount: annotations.length,
		} );
	}

	function syncMarkers() {
		const currentPathname = window.location.pathname;
		const ids = new Set( annotations.map( ( a ) => a.id ) );
		for ( const [ id, marker ] of markerNodes ) {
			if ( ! ids.has( id ) ) {
				marker.remove();
				markerNodes.delete( id );
			}
		}
		annotations.forEach( ( ann, idx ) => {
			/* Only render markers for annotations made on the current page.
			 * Annotations from other pages are preserved for submission but
			 * their document-coordinate positions would be meaningless here. */
			const onCurrentPage = ! ann.pathname || ann.pathname === currentPathname;
			let marker = markerNodes.get( ann.id );
			if ( ! onCurrentPage ) {
				if ( marker ) {
					marker.remove();
					markerNodes.delete( ann.id );
				}
				return;
			}
			if ( ! marker ) {
				marker = document.createElement( 'button' );
				marker.type = 'button';
				marker.className = 'marker';
				marker.addEventListener( 'click', ( e ) => {
					e.stopPropagation();
					const current = annotations.find( ( a ) => a.id === ann.id );
					if ( current ) openPopupForAnnotation( current );
				} );
				root.appendChild( marker );
				markerNodes.set( ann.id, marker );
			}
			const box = resolveTargetRect( ann );
			if ( box ) {
				const inset = 12;
				const viewport = {
					left: window.scrollX,
					top: window.scrollY,
					right: window.scrollX + window.innerWidth,
					bottom: window.scrollY + window.innerHeight,
				};
				const boxRight = box.left + box.width;
				const boxBottom = box.top + box.height;
				const isVisible =
					boxRight >= viewport.left &&
					box.left <= viewport.right &&
					boxBottom >= viewport.top &&
					box.top <= viewport.bottom;
				marker.style.display = isVisible ? '' : 'none';
				if ( isVisible ) {
					marker.style.left =
						Math.min(
							Math.max( boxRight, viewport.left + inset ),
							viewport.right - inset
						) + 'px';
					marker.style.top =
						Math.min(
							Math.max( box.top, viewport.top + inset ),
							viewport.bottom - inset
						) + 'px';
				}
			}
			marker.textContent = String( idx + 1 );
			marker.title = ann.comment;
			marker.setAttribute( 'aria-label', 'Annotation ' + ( idx + 1 ) + ': ' + ann.comment );
		} );
	}

	function resolveTargetRect( target ) {
		let el = null;
		try {
			el = target.selector ? document.querySelector( target.selector ) : null;
		} catch {}
		return el ? documentRect( el ) : target.documentRect || target.boundingBox || null;
	}

	function positionHighlight( node, rect ) {
		node.style.left = rect.left + 'px';
		node.style.top = rect.top + 'px';
		node.style.width = rect.width + 'px';
		node.style.height = rect.height + 'px';
	}

	function syncAnnotationHighlights() {
		const ids = new Set( annotations.map( ( annotation ) => annotation.id ) );
		for ( const [ id, node ] of annotationHighlightNodes ) {
			if ( ! ids.has( id ) ) {
				node.remove();
				annotationHighlightNodes.delete( id );
			}
		}
		for ( const annotation of annotations ) {
			const rect = resolveTargetRect( annotation );
			if ( ! rect ) continue;
			let node = annotationHighlightNodes.get( annotation.id );
			if ( ! node ) {
				node = document.createElement( 'div' );
				node.className = 'annotation-highlight';
				root.appendChild( node );
				annotationHighlightNodes.set( annotation.id, node );
			}
			positionHighlight( node, rect );
		}
	}

	function showHighlight( el ) {
		if ( highlightNode ) {
			highlightNode.remove();
			highlightNode = null;
		}
		const rect = activePopup ? resolveTargetRect( activePopup.target ) : el ? documentRect( el ) : null;
		if ( ! rect || ! isPicking ) return;
		highlightNode = document.createElement( 'div' );
		highlightNode.className = 'highlight';
		positionHighlight( highlightNode, rect );
		root.appendChild( highlightNode );
	}

	function syncScrim() {
		if ( ! activePopup ) {
			scrimNodes.splice( 0 ).forEach( ( node ) => node.remove() );
			return;
		}
		const rect = resolveTargetRect( activePopup.target );
		if ( ! rect ) {
			scrimNodes.splice( 0 ).forEach( ( node ) => node.remove() );
			return;
		}
		while ( scrimNodes.length < 4 ) {
			const node = document.createElement( 'div' );
			node.className = 'scrim';
			root.appendChild( node );
			scrimNodes.push( node );
		}
		const left = Math.min( window.innerWidth, Math.max( 0, rect.left - window.scrollX ) );
		const top = Math.min( window.innerHeight, Math.max( 0, rect.top - window.scrollY ) );
		const right = Math.min(
			window.innerWidth,
			Math.max( left, rect.left + rect.width - window.scrollX )
		);
		const bottom = Math.min(
			window.innerHeight,
			Math.max( top, rect.top + rect.height - window.scrollY )
		);
		const panels = [
			{ left: 0, top: 0, width: window.innerWidth, height: top },
			{ left: 0, top: bottom, width: window.innerWidth, height: window.innerHeight - bottom },
			{ left: 0, top, width: left, height: bottom - top },
			{ left: right, top, width: window.innerWidth - right, height: bottom - top },
		];
		scrimNodes.forEach( ( node, index ) => {
			const panel = panels[ index ];
			node.style.left = panel.left + 'px';
			node.style.top = panel.top + 'px';
			node.style.width = panel.width + 'px';
			node.style.height = panel.height + 'px';
		} );
	}

	function showPopup() {
		if ( popupNode ) {
			popupNode.remove();
			popupNode = null;
		}
		if ( activePopup ) {
			popupNode = buildPopup( activePopup );
			root.appendChild( popupNode );
		}
	}

	function render() {
		syncScrollLock();
		syncMarkers();
		syncAnnotationHighlights();
		syncScrim();
		showHighlight( hoveredEl );
		showPopup();
		sendState();
	}

	function togglePicking() {
		isPicking = ! isPicking;
		if ( ! isPicking ) hoveredEl = null;
		activePopup = null;
		persistAnnotations();
		render();
	}

	function commitActivePopup() {
		if ( ! activePopup ) return true;
		const state = activePopup;
		const trimmed = ( state.comment || '' ).trim();
		if ( ! trimmed ) return false;
		if ( state.id ) {
			annotations = annotations.map( ( annotation ) =>
				annotation.id === state.id
					? Object.assign( {}, annotation, { comment: trimmed, updatedAt: Date.now() } )
					: annotation
			);
		} else {
			if ( annotations.length >= MAX_ANNOTATIONS ) return false;
			state.id = uid();
			annotations = annotations.concat( [
				{
					id: state.id,
					comment: trimmed,
					selector: state.target.selector,
					tag: state.target.tag,
					elementLabel: state.target.elementLabel,
					nearbyText: state.target.nearbyText,
					boundingBox: state.target.boundingBox,
					documentRect: state.target.documentRect,
					computedStyles: state.target.computedStyles,
					pathname: window.location.pathname,
					url: window.location.href,
					timestamp: Date.now(),
				},
			] );
		}
		persistAnnotations();
		return true;
	}

	function submitAnnotations() {
		if ( ! commitActivePopup() ) {
			sendState();
			return;
		}
		if ( annotations.length === 0 ) {
			sendState();
			return;
		}
		const sent = annotations.slice();
		send( { type: 'done', annotations: sent } );
		annotations = [];
		activePopup = null;
		isPicking = false;
		hoveredEl = null;
		persistAnnotations();
		render();
	}

	function cancelAnnotations() {
		annotations = [];
		activePopup = null;
		isPicking = false;
		hoveredEl = null;
		persistAnnotations();
		render();
	}

	window.addEventListener( COMMAND_EVENT, ( event ) => {
		const command = event.detail || {};
		if ( command.bridgeToken !== BRIDGE_TOKEN ) return;
		if ( command.type === 'toggle-picking' ) {
			togglePicking();
			return;
		}
		if ( command.type === 'submit' ) {
			submitAnnotations();
			return;
		}
		if ( command.type === 'cancel' ) {
			cancelAnnotations();
			return;
		}
		if ( command.type === 'report-state' ) {
			sendState();
		}
	} );

	function buildPopup( state ) {
		const popup = document.createElement( 'div' );
		popup.className = 'popup';
		popup.setAttribute( 'role', 'dialog' );
		popup.setAttribute( 'aria-label', 'Annotate selected element' );

		/* Position the popup near the element using viewport coords (it's
		 * \`position: fixed\` so it stays in the viewport). Falls back to
		 * centre if the element can't be located. */
		let el = null;
		try {
			el = state.target.selector ? document.querySelector( state.target.selector ) : null;
		} catch {}
		if ( state.popupPosition ) {
			popup.style.left = state.popupPosition.left + 'px';
			popup.style.top = state.popupPosition.top + 'px';
		} else if ( el ) {
			const r = el.getBoundingClientRect();
			const popupWidth = Math.min( 360, window.innerWidth - 16 );
			const gap = 12;
			const left = Math.min(
				Math.max( 8, r.left + r.width / 2 - popupWidth / 2 ),
				window.innerWidth - popupWidth - 8
			);
			let top = r.bottom + gap;
			if ( top + 150 > window.innerHeight ) {
				top = Math.max( 8, r.top - 150 - gap );
			}
			state.popupPosition = { left, top };
			popup.style.left = state.popupPosition.left + 'px';
			popup.style.top = state.popupPosition.top + 'px';
		} else {
			state.popupPosition = {
				left: Math.max( 8, ( window.innerWidth - Math.min( 360, window.innerWidth - 16 ) ) / 2 ),
				top: Math.max( 8, ( window.innerHeight - 150 ) / 2 ),
			};
			popup.style.left = state.popupPosition.left + 'px';
			popup.style.top = state.popupPosition.top + 'px';
		}

		const targetRow = document.createElement( 'div' );
		targetRow.className = 'target-row';
		const target = document.createElement( 'div' );
		target.className = 'target';
		target.textContent = state.target.elementLabel || state.target.tag;
		target.title = [ state.target.selector, state.target.nearbyText ].filter( Boolean ).join( '\n' );
		targetRow.appendChild( target );
		if ( state.targets && state.targets.length > 1 ) {
			const controls = document.createElement( 'div' );
			controls.className = 'layer-controls';
			const changeTarget = ( offset ) => {
				state.targetIndex =
					( state.targetIndex + offset + state.targets.length ) % state.targets.length;
				state.target = state.targets[ state.targetIndex ];
				render();
			};
			const previous = document.createElement( 'button' );
			previous.type = 'button';
			previous.className = 'layer-button';
			previous.textContent = '‹';
			previous.title = 'Select previous element at this point';
			previous.setAttribute( 'aria-label', previous.title );
			previous.addEventListener( 'click', () => changeTarget( -1 ) );
			const count = document.createElement( 'span' );
			count.className = 'layer-count';
			count.textContent = ( state.targetIndex + 1 ) + '/' + state.targets.length;
			const next = document.createElement( 'button' );
			next.type = 'button';
			next.className = 'layer-button';
			next.textContent = '›';
			next.title = 'Select next element at this point';
			next.setAttribute( 'aria-label', next.title );
			next.addEventListener( 'click', () => changeTarget( 1 ) );
			controls.append( previous, count, next );
			targetRow.appendChild( controls );
		}
		targetRow.addEventListener( 'mousedown', ( event ) => {
			if ( event.button !== 0 || event.target.closest( 'button' ) ) return;
			event.preventDefault();
			const startX = event.clientX;
			const startY = event.clientY;
			const startLeft = state.popupPosition.left;
			const startTop = state.popupPosition.top;
			let nextPosition = { left: startLeft, top: startTop };
			let animationFrame = null;
			let didDrag = false;
			popup.classList.add( 'dragging' );
			targetRow.classList.add( 'dragging' );
			const move = ( moveEvent ) => {
				moveEvent.preventDefault();
				moveEvent.stopPropagation();
				if (
					Math.abs( moveEvent.clientX - startX ) > 2 ||
					Math.abs( moveEvent.clientY - startY ) > 2
				) {
					didDrag = true;
				}
				const width = popup.offsetWidth || Math.min( 360, window.innerWidth - 16 );
				const height = popup.offsetHeight || 150;
				nextPosition = {
					left: Math.min(
						Math.max( 8, startLeft + moveEvent.clientX - startX ),
						Math.max( 8, window.innerWidth - width - 8 )
					),
					top: Math.min(
						Math.max( 8, startTop + moveEvent.clientY - startY ),
						Math.max( 8, window.innerHeight - height - 8 )
					),
				};
				if ( animationFrame !== null ) return;
				animationFrame = window.requestAnimationFrame( () => {
					animationFrame = null;
					popup.style.transform =
						'translate3d(' +
						( nextPosition.left - startLeft ) +
						'px,' +
						( nextPosition.top - startTop ) +
						'px,0)';
				} );
			};
			const stop = () => {
				if ( animationFrame !== null ) window.cancelAnimationFrame( animationFrame );
				animationFrame = null;
				state.popupPosition = nextPosition;
				popup.style.left = state.popupPosition.left + 'px';
				popup.style.top = state.popupPosition.top + 'px';
				popup.style.transform = '';
				popup.classList.remove( 'dragging' );
				targetRow.classList.remove( 'dragging' );
				window.removeEventListener( 'mousemove', move, true );
				window.removeEventListener( 'mouseup', stop, true );
				window.removeEventListener( 'blur', stop, true );
				if ( didDrag ) {
					const suppressClick = ( clickEvent ) => {
						clickEvent.preventDefault();
						clickEvent.stopPropagation();
					};
					window.addEventListener( 'click', suppressClick, { capture: true, once: true } );
					setTimeout( () => window.removeEventListener( 'click', suppressClick, true ), 0 );
				}
			};
			window.addEventListener( 'mousemove', move, true );
			window.addEventListener( 'mouseup', stop, true );
			window.addEventListener( 'blur', stop, true );
		} );
		popup.appendChild( targetRow );

		const ta = document.createElement( 'textarea' );
		ta.placeholder = 'What should change about this element?';
		ta.maxLength = 10000;
		ta.value = state.comment || '';
		const resizeTextarea = () => {
			ta.style.height = '24px';
			ta.style.height = Math.min( ta.scrollHeight, 100 ) + 'px';
		};
		ta.addEventListener( 'input', () => {
			state.comment = ta.value;
			save.disabled = ! state.comment.trim();
			sendToChat.disabled = save.disabled;
			resizeTextarea();
		} );
		popup.appendChild( ta );
		setTimeout( () => {
			resizeTextarea();
			ta.focus();
		}, 0 );

		const actions = document.createElement( 'div' );
		actions.className = 'actions';
		const leftActions = document.createElement( 'div' );
		leftActions.className = 'left-actions';

		const closePopup = () => {
			activePopup = null;
			hoveredEl = null;
			persistAnnotations();
			render();
		};

		const cancel = document.createElement( 'button' );
		cancel.type = 'button';
		cancel.className = 'cancel';
		cancel.textContent = 'Cancel';
		cancel.addEventListener( 'click', closePopup );
		leftActions.appendChild( cancel );

		if ( state.id ) {
			const del = document.createElement( 'button' );
			del.type = 'button';
			del.className = 'delete';
			del.textContent = 'Delete';
			del.addEventListener( 'click', () => {
				annotations = annotations.filter( ( a ) => a.id !== state.id );
				activePopup = null;
				persistAnnotations();
				render();
			} );
			leftActions.appendChild( del );
		}
		actions.appendChild( leftActions );

		const sendToChat = document.createElement( 'button' );
		sendToChat.type = 'button';
		sendToChat.className = 'send-to-chat';
		sendToChat.textContent = 'Send to chat';
		sendToChat.disabled = ! ( state.comment && state.comment.trim() );
		sendToChat.addEventListener( 'click', submitAnnotations );
		actions.appendChild( sendToChat );

		const save = document.createElement( 'button' );
		save.type = 'button';
		save.className = 'save';
		save.setAttribute( 'aria-label', state.id ? 'Update note' : 'Save note' );
		save.title = state.id ? 'Update note' : 'Save note';
		save.disabled = ! ( state.comment && state.comment.trim() );
		save.addEventListener( 'click', () => {
			if ( ! commitActivePopup() ) return;
			closePopup();
		} );
		actions.appendChild( save );

		ta.addEventListener( 'keydown', ( event ) => {
			if ( event.key !== 'Enter' ) return;
			if ( event.metaKey || event.ctrlKey ) {
				event.preventDefault();
				const start = ta.selectionStart;
				const end = ta.selectionEnd;
				ta.value = ta.value.slice( 0, start ) + '\n' + ta.value.slice( end );
				state.comment = ta.value;
				ta.setSelectionRange( start + 1, start + 1 );
				save.disabled = ! state.comment.trim();
				sendToChat.disabled = save.disabled;
				resizeTextarea();
				return;
			}
			if ( event.shiftKey ) return;
			event.preventDefault();
			save.click();
		} );

		popup.appendChild( actions );

		popup.addEventListener( 'click', ( e ) => e.stopPropagation() );
		popup.addEventListener( 'mousemove', ( e ) => e.stopPropagation() );

		return popup;
	}

	function openPopupForAnnotation( ann ) {
		isPicking = true;
		hoveredEl = null;
		activePopup = {
			id: ann.id,
			comment: ann.comment,
			target: {
				selector: ann.selector,
				tag: ann.tag,
				elementLabel: ann.elementLabel,
				nearbyText: ann.nearbyText,
				boundingBox: ann.boundingBox,
				documentRect: ann.documentRect,
				computedStyles: ann.computedStyles,
			},
		};
		persistAnnotations();
		render();
	}

	function targetForElement( el ) {
		const viewport = el.getBoundingClientRect();
		const classes = Array.from( el.classList || [] )
			.filter( ( className ) => ! className.startsWith( '__studio-' ) )
			.slice( 0, 2 );
		const elementLabel = (
			el.tagName.toLowerCase() +
			( el.id ? '#' + el.id : '' ) +
			classes.map( ( className ) => '.' + className ).join( '' )
		).slice( 0, 240 );
		const selector = buildSelector( el );
		return {
			selector: selector.length <= 1000 ? selector : undefined,
			tag: el.tagName.toLowerCase(),
			elementLabel,
			nearbyText: nearbyText( el ),
			boundingBox: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
			documentRect: documentRect( el ),
			computedStyles: pickComputedStyles( el ),
		};
	}

	function elementsAtPoint( initial, clientX, clientY ) {
		const MAX_CANDIDATES = 30;
		const MAX_FALLBACK_ELEMENTS = 5000;
		const MAX_FALLBACK_MS = 20;
		const candidates = [];
		const seen = new Set();
		const add = ( el ) => {
			if ( candidates.length >= MAX_CANDIDATES || ! el || seen.has( el ) || isOurElement( el ) )
				return;
			if ( el === document.documentElement || el === document.body ) return;
			const rect = el.getBoundingClientRect();
			if ( rect.width <= 0 || rect.height <= 0 ) return;
			const style = window.getComputedStyle( el );
			if ( style.display === 'none' || style.visibility === 'hidden' ) return;
			seen.add( el );
			candidates.push( el );
		};

		add( initial );
		if ( typeof document.elementsFromPoint === 'function' ) {
			document.elementsFromPoint( clientX, clientY ).forEach( add );
		}
		const behind = [];
		const scanStartedAt = performance.now();
		let scannedElements = 0;
		for ( const el of document.querySelectorAll( 'body *' ) ) {
			scannedElements += 1;
			if (
				scannedElements > MAX_FALLBACK_ELEMENTS ||
				( scannedElements % 50 === 0 && performance.now() - scanStartedAt > MAX_FALLBACK_MS )
			) {
				break;
			}
			if ( seen.has( el ) || isOurElement( el ) ) continue;
			const rect = el.getBoundingClientRect();
			if (
					rect.width > 0 &&
					rect.height > 0 &&
					clientX >= rect.left &&
					clientX <= rect.right &&
					clientY >= rect.top &&
					clientY <= rect.bottom
			) {
				behind.push( { el, area: rect.width * rect.height } );
			}
		}
		behind.sort( ( a, b ) => a.area - b.area ).forEach( ( item ) => add( item.el ) );
		return candidates;
	}

	function openPopupForElement( el, clientX, clientY ) {
		const elements = elementsAtPoint( el, clientX, clientY );
		const targets = elements.map( targetForElement );
		isPicking = true;
		activePopup = {
			comment: '',
			target: targets[ 0 ] || targetForElement( el ),
			targets,
			targetIndex: 0,
		};
		persistAnnotations();
		render();
	}

	function isOurElement( el ) {
		return !! ( el && el.closest && el.closest( '#' + HOST_ID ) );
	}

	document.addEventListener(
		'mousemove',
		( e ) => {
			if ( ! isPicking || activePopup ) return;
			if ( isOurElement( e.target ) ) {
				if ( hoveredEl !== null ) {
					hoveredEl = null;
					showHighlight( null );
				}
				return;
			}
			if ( hoveredEl !== e.target ) {
				hoveredEl = e.target;
				showHighlight( hoveredEl );
			}
		},
		true
	);

	document.addEventListener(
		'click',
		( e ) => {
			if ( ! isPicking || activePopup ) return;
			if ( isOurElement( e.target ) ) return;
			e.preventDefault();
			e.stopPropagation();
			openPopupForElement( e.target, e.clientX, e.clientY );
		},
		true
	);

	document.addEventListener(
		'keydown',
		( e ) => {
			const browserCommand = getBrowserShortcutCommand( e );
			if ( browserCommand ) {
				e.preventDefault();
				e.stopPropagation();
				send( { type: 'browser-command', command: browserCommand } );
				return;
			}
			if ( e.key !== 'Escape' ) return;
			if ( activePopup ) {
				activePopup = null;
				hoveredEl = null;
				persistAnnotations();
				render();
			} else if ( isPicking ) {
				isPicking = false;
				hoveredEl = null;
				persistAnnotations();
				render();
			}
		},
		true
	);

	function syncOverlayPositions() {
		syncMarkers();
		syncAnnotationHighlights();
		if ( highlightNode ) {
			const rect = activePopup
				? resolveTargetRect( activePopup.target )
				: hoveredEl
					? documentRect( hoveredEl )
					: null;
			if ( rect ) positionHighlight( highlightNode, rect );
		}
		syncScrim();
	}

	window.addEventListener( 'scroll', syncOverlayPositions, true );
	window.addEventListener( 'resize', syncOverlayPositions );

	render();
} )();
`;
