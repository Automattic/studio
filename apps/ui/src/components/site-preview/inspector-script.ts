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
 * The same bridge also reports picking/annotation-count state changes and
 * forwards browser keyboard shortcuts (reload, back, forward) pressed while
 * focus is inside the guest page, so the host toolbar can handle them:
 *   guest -> host: `__studio-inspector__:{ "type": "state", ... }`
 *   guest -> host: `__studio-inspector__:{ "type": "browser-command", ... }`
 *
 * The annotation controls live in the host toolbar (not in the page), and
 * drive the inspector by dispatching `INSPECTOR_COMMAND_EVENT` custom events
 * on the guest `window` via `webview.executeJavaScript()`:
 *   host -> guest: `{ "type": "toggle-picking" | "submit" | "report-state" }`
 *
 * Layout strategy: markers and the picking highlight use `position: absolute`
 * anchored at *document* coordinates (viewport rect + scroll offset). They
 * scroll with the page automatically — no scroll listener, no rAF loop. The
 * popup uses `position: fixed` so it stays in the viewport.
 */

export const INSPECTOR_BRIDGE_PREFIX = '__studio-inspector__:';
export const INSPECTOR_COMMAND_EVENT = '__studio-inspector-command';

export const INSPECTOR_PAGE_SCRIPT =
	String.raw`
( () => {
	if ( window.__studioInspectorMounted ) {
		window.dispatchEvent(
			new CustomEvent( '` +
	INSPECTOR_COMMAND_EVENT +
	String.raw`', { detail: { type: 'report-state' } } )
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

	function send( payload ) {
		try {
			console.log( BRIDGE_PREFIX + JSON.stringify( payload ) );
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

	/* ------------------------------------------------------------------
	 * Shadow DOM host. The host is \`position: absolute; top: 0; left: 0\`
	 * with zero size — this anchors all absolutely-positioned descendants
	 * at the document origin so their coordinates are document-relative
	 * (and therefore scroll naturally with the page).
	 * ---------------------------------------------------------------- */
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
		.highlight {
			position: absolute; pointer-events: none;
			border: 2px solid #2563eb;
			background: rgba(37,99,235,0.1);
			border-radius: 2px;
		}
		.marker {
			position: absolute; pointer-events: auto; cursor: pointer;
			width: 22px; height: 22px;
			background: #2563eb; color: #fff;
			border: 2px solid #fff;
			border-radius: 50%;
			box-shadow: 0 2px 6px rgba(0,0,0,0.3);
			font: 700 11px/1 inherit;
			display: inline-flex; align-items: center; justify-content: center;
			transform: translate(-50%, -50%);
		}
		.popup {
			position: fixed; width: 320px;
			background: #1a1a1a; color: #fff;
			border-radius: 12px;
			box-shadow: 0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08);
			padding: 12px;
			pointer-events: auto;
			display: flex; flex-direction: column; gap: 8px;
		}
		.popup .target {
			font-size: 11px; color: rgba(255,255,255,0.5);
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.popup textarea {
			width: 100%; min-height: 72px; resize: vertical;
			background: rgba(255,255,255,0.05); color: #fff;
			border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
			padding: 8px; font: 13px/1.4 inherit; outline: none;
		}
		.popup textarea:focus { border-color: #2563eb; }
		.popup .actions { display: flex; justify-content: flex-end; gap: 6px; }
		.popup button {
			padding: 6px 12px; border-radius: 16px; border: none;
			font: 600 12px/1 inherit; cursor: pointer;
		}
		.popup .delete { background: transparent; color: rgba(255,255,255,0.5); margin-right: auto; }
		.popup .delete:hover { color: #ef4444; }
		.popup .cancel { background: transparent; color: rgba(255,255,255,0.7); }
		.popup .cancel:hover { background: rgba(255,255,255,0.08); }
		.popup .save { background: #fff; color: #1a1a1a; }
		.popup .save[disabled] { opacity: 0.4; cursor: default; }
	` +
	'`' +
	String.raw`;
	root.appendChild( style );

	/* ------------------------------------------------------------------
	 * State + DOM
	 * ---------------------------------------------------------------- */
	let isPicking = false;
	let hoveredEl = null;
	let activePopup = null; /* { id?, target, comment, fromPicker? } */
	let annotations = Array.isArray( window.__studioInspectorState )
		? window.__studioInspectorState.slice()
		: [];

	const markerNodes = new Map(); /* id -> marker element */
	let highlightNode = null;
	let popupNode = null;

	function persistAnnotations() {
		window.__studioInspectorState = annotations;
	}

	function sendState() {
		send( {
			type: 'state',
			isPicking,
			annotationCount: annotations.length,
		} );
	}

	function syncMarkers() {
		const ids = new Set( annotations.map( ( a ) => a.id ) );
		for ( const [ id, marker ] of markerNodes ) {
			if ( ! ids.has( id ) ) {
				marker.remove();
				markerNodes.delete( id );
			}
		}
		annotations.forEach( ( ann, idx ) => {
			let marker = markerNodes.get( ann.id );
			if ( ! marker ) {
				marker = document.createElement( 'div' );
				marker.className = 'marker';
				marker.addEventListener( 'click', ( e ) => {
					e.stopPropagation();
					const current = annotations.find( ( a ) => a.id === ann.id );
					if ( current ) openPopupForAnnotation( current );
				} );
				/* Use the document-coord rect captured at save time so the
				 * marker's position is fixed in document space and scrolls
				 * with the page. No per-scroll repositioning needed. */
				const box = ann.documentRect || ann.boundingBox || { left: 0, top: 0, width: 0, height: 0 };
				marker.style.left = ( box.left + box.width ) + 'px';
				marker.style.top = box.top + 'px';
				root.appendChild( marker );
				markerNodes.set( ann.id, marker );
			}
			marker.textContent = String( idx + 1 );
			marker.title = ann.comment;
		} );
	}

	function showHighlight( el ) {
		if ( highlightNode ) {
			highlightNode.remove();
			highlightNode = null;
		}
		if ( ! el || ! isPicking ) return;
		const r = documentRect( el );
		highlightNode = document.createElement( 'div' );
		highlightNode.className = 'highlight';
		highlightNode.style.left = r.left + 'px';
		highlightNode.style.top = r.top + 'px';
		highlightNode.style.width = r.width + 'px';
		highlightNode.style.height = r.height + 'px';
		root.appendChild( highlightNode );
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
		syncMarkers();
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

	function submitAnnotations() {
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

	window.addEventListener( COMMAND_EVENT, ( event ) => {
		const command = event.detail || {};
		if ( command.type === 'toggle-picking' ) {
			togglePicking();
			return;
		}
		if ( command.type === 'submit' ) {
			submitAnnotations();
			return;
		}
		if ( command.type === 'report-state' ) {
			sendState();
		}
	} );

	function buildPopup( state ) {
		const popup = document.createElement( 'div' );
		popup.className = 'popup';

		/* Position the popup near the element using viewport coords (it's
		 * \`position: fixed\` so it stays in the viewport). Falls back to
		 * centre if the element can't be located. */
		let el = null;
		try {
			el = state.target.selector ? document.querySelector( state.target.selector ) : null;
		} catch {}
		if ( el ) {
			const r = el.getBoundingClientRect();
			const popupWidth = 320;
			const gap = 12;
			const left = Math.min(
				Math.max( 8, r.left + r.width / 2 - popupWidth / 2 ),
				window.innerWidth - popupWidth - 8
			);
			let top = r.bottom + gap;
			if ( top + 200 > window.innerHeight ) {
				top = Math.max( 8, r.top - 200 - gap );
			}
			popup.style.left = left + 'px';
			popup.style.top = top + 'px';
		} else {
			popup.style.left = '50%';
			popup.style.top = '50%';
			popup.style.transform = 'translate(-50%, -50%)';
		}

		const target = document.createElement( 'div' );
		target.className = 'target';
		target.textContent =
			state.target.tag +
			( state.target.nearbyText ? ' — ' + state.target.nearbyText : '' );
		popup.appendChild( target );

		const ta = document.createElement( 'textarea' );
		ta.placeholder = 'What should change about this element?';
		ta.value = state.comment || '';
		ta.addEventListener( 'input', () => {
			state.comment = ta.value;
			save.disabled = ! state.comment.trim();
		} );
		popup.appendChild( ta );
		setTimeout( () => ta.focus(), 0 );

		const actions = document.createElement( 'div' );
		actions.className = 'actions';

		if ( state.id ) {
			const del = document.createElement( 'button' );
			del.className = 'delete';
			del.textContent = 'Delete';
			del.addEventListener( 'click', () => {
				annotations = annotations.filter( ( a ) => a.id !== state.id );
				activePopup = null;
				persistAnnotations();
				render();
			} );
			actions.appendChild( del );
		}

		const closePopup = () => {
			activePopup = null;
			/* Picking does NOT auto-resume after save/cancel. Auto-resume was
			 * convenient for chaining annotations but it silently blocks every
			 * link click in the page (the picking handler calls
			 * preventDefault), making the preview feel broken. The user
			 * re-enters picking mode via the Annotate button. */
			isPicking = false;
			hoveredEl = null;
			persistAnnotations();
			render();
		};

		const cancel = document.createElement( 'button' );
		cancel.className = 'cancel';
		cancel.textContent = 'Cancel';
		cancel.addEventListener( 'click', closePopup );
		actions.appendChild( cancel );

		const save = document.createElement( 'button' );
		save.className = 'save';
		save.textContent = state.id ? 'Update' : 'Save';
		save.disabled = ! ( state.comment && state.comment.trim() );
		save.addEventListener( 'click', () => {
			const trimmed = ( state.comment || '' ).trim();
			if ( ! trimmed ) return;
			if ( state.id ) {
				annotations = annotations.map( ( a ) =>
					a.id === state.id
						? Object.assign( {}, a, { comment: trimmed, updatedAt: Date.now() } )
						: a
				);
			} else {
				annotations = annotations.concat( [
					{
						id: uid(),
						comment: trimmed,
						selector: state.target.selector,
						tag: state.target.tag,
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
			closePopup();
		} );
		actions.appendChild( save );

		popup.appendChild( actions );

		popup.addEventListener( 'click', ( e ) => e.stopPropagation() );
		popup.addEventListener( 'mousemove', ( e ) => e.stopPropagation() );

		return popup;
	}

	function openPopupForAnnotation( ann ) {
		isPicking = false;
		hoveredEl = null;
		activePopup = {
			id: ann.id,
			comment: ann.comment,
			target: {
				selector: ann.selector,
				tag: ann.tag,
				nearbyText: ann.nearbyText,
				boundingBox: ann.boundingBox,
				documentRect: ann.documentRect,
				computedStyles: ann.computedStyles,
			},
		};
		persistAnnotations();
		render();
	}

	function openPopupForElement( el ) {
		const viewport = el.getBoundingClientRect();
		isPicking = false;
		activePopup = {
			fromPicker: true,
			comment: '',
			target: {
				selector: buildSelector( el ),
				tag: el.tagName.toLowerCase(),
				nearbyText: nearbyText( el ),
				boundingBox: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
				documentRect: documentRect( el ),
				computedStyles: pickComputedStyles( el ),
			},
		};
		persistAnnotations();
		render();
	}

	function isOurElement( el ) {
		return !! ( el && el.closest && el.closest( '#' + HOST_ID ) );
	}

	/* ------------------------------------------------------------------
	 * Picking interactions. Only the highlight is updated on mousemove —
	 * markers are document-anchored and don't move with mouse position.
	 * No scroll/resize listeners: markers and highlight live in document
	 * coordinates and follow the page naturally.
	 * ---------------------------------------------------------------- */
	document.addEventListener(
		'mousemove',
		( e ) => {
			if ( ! isPicking ) return;
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
			if ( ! isPicking ) return;
			if ( isOurElement( e.target ) ) return;
			e.preventDefault();
			e.stopPropagation();
			openPopupForElement( e.target );
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

	render();
} )();
`;
