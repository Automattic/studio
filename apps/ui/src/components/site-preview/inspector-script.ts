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
 * The same bridge also reports picking/annotation-count/loupe state changes
 * and forwards browser keyboard shortcuts (reload, back, forward) pressed
 * while focus is inside the guest page, so the host toolbar can handle them:
 *   guest -> host: `__studio-inspector__:{ "type": "state", ... }`
 *   guest -> host: `__studio-inspector__:{ "type": "browser-command", ... }`
 *
 * The loupe magnifies the page inside a lens that follows the cursor while
 * the primary modifier key is held (Cmd on Apple, Ctrl elsewhere). The
 * guest can't screenshot itself, so it asks the host for captures of the
 * visible viewport (debounced on scroll/resize/zoom) and the host pushes
 * them back in as data URLs via `window.__studioLoupeBackdrop()`; cursor
 * tracking is then fully local — no bridge traffic per mousemove. Clicking
 * while the loupe is up asks the host to snap the lens region:
 *   guest -> host: `__studio-inspector__:{ "type": "loupe-capture", ... }`
 *   guest -> host: `__studio-inspector__:{ "type": "loupe-snap", ... }`
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

	function getBrowserShortcutCommand( event ) {
		if ( event.defaultPrevented || event.repeat || event.shiftKey || event.altKey ) return null;
		const hasPrimaryModifier = isApplePlatform() ? event.metaKey : event.ctrlKey;
		if ( ! hasPrimaryModifier ) return null;
		const key = event.key.toLowerCase();
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
		.loupe {
			position: fixed; pointer-events: none; display: none;
			background: #fff;
			outline: 1px solid rgba(0,0,0,0.35);
			box-shadow: 0 8px 32px rgba(0,0,0,0.35);
		}
		.loupe .clip {
			position: absolute; inset: 0;
			overflow: hidden;
		}
		/* The backdrop stays at its natural CSS size and is magnified with a
		 * compositor transform — scaling via background-size rasterizes a
		 * layer of viewport-size × zoom² pixels, which Chromium silently
		 * refuses to paint once it passes the texture budget. */
		.loupe .backdrop {
			position: absolute; left: 0; top: 0;
			transform-origin: 0 0;
			background-repeat: no-repeat;
			background-size: 100% 100%;
			/* Magnifying real rendered pixels: crisp blocks beat blur. */
			image-rendering: pixelated;
			will-change: transform;
		}
		/* Viewfinder corner notches instead of rounded corners: L-shaped
		 * marks in the inspector accent, protruding past the frame. */
		.loupe .corner {
			position: absolute; width: 12px; height: 12px;
			border: 2px solid #2563eb;
		}
		.loupe .corner.tl { top: -4px; left: -4px; border-right: none; border-bottom: none; }
		.loupe .corner.tr { top: -4px; right: -4px; border-left: none; border-bottom: none; }
		.loupe .corner.bl { bottom: -4px; left: -4px; border-right: none; border-top: none; }
		.loupe .corner.br { bottom: -4px; right: -4px; border-left: none; border-top: none; }
		.loupe .badge {
			position: absolute; bottom: 8px; left: 50%;
			transform: translateX(-50%);
			background: rgba(26,26,26,0.85); color: #fff;
			font: 600 11px/1 inherit;
			padding: 4px 8px; border-radius: 4px;
			white-space: nowrap;
		}
		.loupe .flash {
			position: absolute; inset: 0;
			background: #fff; opacity: 0;
		}
		.loupe .hint {
			position: absolute; top: 100%; left: 50%;
			transform: translate(-50%, 8px);
			background: rgba(26,26,26,0.85); color: rgba(255,255,255,0.8);
			font: 500 10px/1 inherit;
			padding: 4px 7px; border-radius: 4px;
			white-space: nowrap;
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
			isLoupeActive: loupeActive,
			loupeZoom,
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
		if ( isPicking ) deactivateLoupe( { silent: true } );
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
		/* Hold-key state forwarded by the host for presses that happen while
		 * focus is outside the guest (idempotent either way). Neither
		 * affects a sticky (menu-toggled) loupe. */
		if ( command.type === 'loupe-hold-start' ) {
			activateLoupe( false );
			return;
		}
		if ( command.type === 'loupe-hold-end' ) {
			if ( ! loupeSticky ) deactivateLoupe();
			return;
		}
		/* Menu toggle: a sticky loupe that survives the hold-key lifecycle. */
		if ( command.type === 'loupe-toggle' ) {
			if ( loupeActive ) {
				deactivateLoupe();
			} else {
				activateLoupe( true );
			}
			return;
		}
		/* Reseeds the remembered zoom after a navigation resets this script. */
		if ( command.type === 'loupe-set-zoom' ) {
			setLoupeZoom( command.zoom );
			return;
		}
		if ( command.type === 'loupe-refresh' ) {
			if ( loupeActive ) sendLoupeCaptureRequest();
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

	/* ------------------------------------------------------------------
	 * Loupe. Held-key magnifier: active only while the primary modifier
	 * (Cmd on Apple, Ctrl elsewhere) is held down. A rounded-rect lens
	 * (in the shadow root) follows the cursor showing a magnified view of
	 * the page. The magnified pixels come from viewport captures the host
	 * takes on request and pushes back as data URLs, so mousemove handling
	 * never crosses the bridge. Wheel adjusts zoom (shift+wheel adjusts
	 * lens size), click asks the host to snap the lens region to the
	 * composer. Pressing any other key while holding (i.e. a keyboard
	 * shortcut) cancels the loupe until the modifier is pressed again;
	 * releasing outside the window is self-healed on the next mousemove
	 * via the event's live modifier state.
	 * ---------------------------------------------------------------- */
	const LOUPE_MIN_ZOOM = 1;
	const LOUPE_MAX_ZOOM = 8;
	const LOUPE_MIN_WIDTH = 160;
	const LOUPE_MAX_WIDTH = 480;
	/* 16:10 lens. */
	const LOUPE_ASPECT = 0.625;

	function loupeHoldKey() {
		return isApplePlatform() ? 'Meta' : 'Control';
	}

	function isLoupeHoldModifierDown( event ) {
		return isApplePlatform() ? event.metaKey : event.ctrlKey;
	}

	let loupeActive = false;
	/* Sticky = turned on from the host's overflow menu; stays on until
	 * toggled off or Escape, unaffected by the hold-key lifecycle. */
	let loupeSticky = false;
	let loupeZoom = 3;
	let loupeWidth = 280;
	let loupeCursorX = -1;
	let loupeCursorY = -1;
	let loupeBackdrop = null; /* { url, x, y, width, height, scale } document coords */
	let loupeCaptureTimer = 0;
	let loupeNode = null;
	let loupeBackdropNode = null;
	let loupeBadgeNode = null;
	let loupeFlashNode = null;
	let loupeSavedCursor = '';
	/* True while the host is taking a viewport capture: the lens is hidden
	 * so it can't photograph itself into its own backdrop, and mousemove
	 * must not re-show it until the capture lands. */
	let loupeCaptureHidden = false;

	function ensureLoupeNodes() {
		if ( loupeNode ) return;
		loupeNode = document.createElement( 'div' );
		loupeNode.className = 'loupe';
		const clip = document.createElement( 'div' );
		clip.className = 'clip';
		loupeBackdropNode = document.createElement( 'div' );
		loupeBackdropNode.className = 'backdrop';
		clip.appendChild( loupeBackdropNode );
		loupeFlashNode = document.createElement( 'div' );
		loupeFlashNode.className = 'flash';
		loupeBadgeNode = document.createElement( 'div' );
		loupeBadgeNode.className = 'badge';
		loupeNode.appendChild( clip );
		loupeNode.appendChild( loupeFlashNode );
		loupeNode.appendChild( loupeBadgeNode );
		[ 'tl', 'tr', 'bl', 'br' ].forEach( ( corner ) => {
			const mark = document.createElement( 'div' );
			mark.className = 'corner ' + corner;
			loupeNode.appendChild( mark );
		} );
		const hint = document.createElement( 'div' );
		hint.className = 'hint';
		hint.textContent = 'Snap to chat';
		loupeNode.appendChild( hint );
		root.appendChild( loupeNode );
	}

	function sendLoupeCaptureRequest() {
		/* The host captures the whole visible viewport; docX/docY anchor it
		 * in document coordinates (they're echoed back with the capture). */
		send( {
			type: 'loupe-capture',
			docX: window.scrollX,
			docY: window.scrollY,
			width: window.innerWidth,
			height: window.innerHeight,
		} );
	}

	function scheduleLoupeCapture() {
		clearTimeout( loupeCaptureTimer );
		loupeCaptureTimer = setTimeout( sendLoupeCaptureRequest, 120 );
	}

	/* Called by the host just before every viewport capture (backdrop and
	 * snap). Hides the lens and resolves after the hidden frame has had a
	 * chance to paint, so the capture never contains the lens itself. */
	window.__studioLoupePrepareCapture = () => {
		if ( ! loupeActive || ! loupeNode ) return Promise.resolve( true );
		loupeCaptureHidden = true;
		loupeNode.style.display = 'none';
		return new Promise( ( resolve ) => {
			requestAnimationFrame( () => {
				requestAnimationFrame( () => resolve( true ) );
			} );
		} );
	};

	/* Called by the host after a capture that doesn't push a backdrop
	 * (snaps, failures) to bring the lens back. */
	window.__studioLoupeFinishCapture = () => {
		loupeCaptureHidden = false;
		updateLoupe();
	};

	window.__studioLoupeBackdrop = ( payload ) => {
		loupeCaptureHidden = false;
		if ( ! loupeActive || ! payload || typeof payload.url !== 'string' ) return;
		loupeBackdrop = payload;
		if ( loupeBackdropNode ) {
			loupeBackdropNode.style.backgroundImage = 'url("' + payload.url + '")';
			loupeBackdropNode.style.width = payload.width + 'px';
			loupeBackdropNode.style.height = payload.height + 'px';
		}
		updateLoupe();
	};

	function updateLoupe() {
		if ( ! loupeActive || ! loupeNode ) return;
		/* Stay hidden while a capture is in flight (see PrepareCapture). */
		if ( loupeCaptureHidden ) return;
		if ( loupeCursorX < 0 || loupeCursorY < 0 ) {
			loupeNode.style.display = 'none';
			return;
		}
		const lw = loupeWidth;
		const lh = Math.round( loupeWidth * LOUPE_ASPECT );
		/* Avoid-mouse placement: above-right of the cursor, flipping near
		 * window edges so the lens never sits under the pointer. */
		let left = loupeCursorX + 20;
		let top = loupeCursorY - lh - 20;
		if ( left + lw > window.innerWidth - 8 ) left = loupeCursorX - lw - 20;
		if ( top < 8 ) top = loupeCursorY + 20;
		left = Math.max( 8, Math.min( window.innerWidth - lw - 8, left ) );
		/* Extra bottom room keeps the "snap to chat" hint pill visible. */
		top = Math.max( 8, Math.min( window.innerHeight - lh - 34, top ) );
		loupeNode.style.display = 'block';
		loupeNode.style.width = lw + 'px';
		loupeNode.style.height = lh + 'px';
		loupeNode.style.left = left + 'px';
		loupeNode.style.top = top + 'px';
		loupeBadgeNode.textContent = Math.round( loupeZoom * 10 ) / 10 + '×';
		if ( loupeBackdrop ) {
			/* Keep the page point under the cursor at the lens centre. */
			const docX = loupeCursorX + window.scrollX;
			const docY = loupeCursorY + window.scrollY;
			const tx = lw / 2 - ( docX - loupeBackdrop.x ) * loupeZoom;
			const ty = lh / 2 - ( docY - loupeBackdrop.y ) * loupeZoom;
			loupeBackdropNode.style.transform =
				'translate(' + tx + 'px, ' + ty + 'px) scale(' + loupeZoom + ')';
		}
	}

	function activateLoupe( sticky ) {
		if ( loupeActive ) return;
		loupeActive = true;
		loupeSticky = !! sticky;
		isPicking = false;
		hoveredEl = null;
		activePopup = null;
		ensureLoupeNodes();
		loupeSavedCursor = document.documentElement.style.cursor;
		document.documentElement.style.cursor = 'crosshair';
		sendLoupeCaptureRequest();
		persistAnnotations();
		render();
		updateLoupe();
	}

	function setLoupeZoom( zoom ) {
		if ( typeof zoom !== 'number' || ! isFinite( zoom ) ) return;
		loupeZoom = Math.max( LOUPE_MIN_ZOOM, Math.min( LOUPE_MAX_ZOOM, zoom ) );
		if ( loupeActive ) updateLoupe();
	}

	function deactivateLoupe( options ) {
		if ( ! loupeActive ) return;
		loupeActive = false;
		loupeSticky = false;
		loupeBackdrop = null;
		loupeCaptureHidden = false;
		clearTimeout( loupeCaptureTimer );
		if ( loupeNode ) {
			loupeNode.style.display = 'none';
			loupeBackdropNode.style.backgroundImage = '';
		}
		document.documentElement.style.cursor = loupeSavedCursor;
		if ( ! ( options && options.silent ) ) sendState();
	}

	function flashLoupe() {
		if ( ! loupeFlashNode ) return;
		loupeFlashNode.style.transition = 'none';
		loupeFlashNode.style.opacity = '0.85';
		requestAnimationFrame( () => {
			requestAnimationFrame( () => {
				loupeFlashNode.style.transition = 'opacity 0.35s ease';
				loupeFlashNode.style.opacity = '0';
			} );
		} );
	}

	document.addEventListener(
		'mousemove',
		( e ) => {
			loupeCursorX = e.clientX;
			loupeCursorY = e.clientY;
			if ( ! loupeActive ) return;
			/* Self-heal a lost keyup (modifier released outside the window):
			 * every mouse event carries the live modifier state. */
			if ( ! loupeSticky && ! isLoupeHoldModifierDown( e ) ) {
				deactivateLoupe();
				return;
			}
			updateLoupe();
		},
		true
	);

	document.addEventListener(
		'mouseleave',
		() => {
			loupeCursorX = -1;
			loupeCursorY = -1;
			if ( loupeActive ) updateLoupe();
		},
		true
	);

	window.addEventListener(
		'wheel',
		( e ) => {
			if ( ! loupeActive ) return;
			e.preventDefault();
			const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
			if ( e.shiftKey ) {
				loupeWidth = Math.max(
					LOUPE_MIN_WIDTH,
					Math.min( LOUPE_MAX_WIDTH, loupeWidth - delta * 0.5 )
				);
			} else {
				/* No recapture needed: the backdrop is a native-resolution
				 * viewport capture magnified by a compositor transform, so
				 * zooming just rescales it. Recapturing here would blink the
				 * lens (it hides during captures to stay out of its own
				 * backdrop) for no new pixels. */
				loupeZoom = Math.max(
					LOUPE_MIN_ZOOM,
					Math.min( LOUPE_MAX_ZOOM, loupeZoom * Math.exp( -delta * 0.003 ) )
				);
			}
			updateLoupe();
		},
		{ capture: true, passive: false }
	);

	window.addEventListener(
		'scroll',
		() => {
			if ( ! loupeActive ) return;
			updateLoupe();
			scheduleLoupeCapture();
		},
		{ capture: true, passive: true }
	);

	window.addEventListener( 'resize', () => {
		if ( ! loupeActive ) return;
		updateLoupe();
		scheduleLoupeCapture();
	} );

	document.addEventListener(
		'click',
		( e ) => {
			if ( ! loupeActive ) return;
			e.preventDefault();
			e.stopPropagation();
			if ( loupeCursorX < 0 || loupeCursorY < 0 ) return;
			/* Snap the content visible in the lens: a lens-shaped rect centred
			 * on the cursor, \`lens size / zoom\` CSS px wide, sent as a
			 * viewport-relative rect for the host to crop out of a fresh
			 * viewport capture. Clamped so the crop stays capturable. */
			const edgeW = Math.min( loupeWidth / loupeZoom, window.innerWidth );
			const edgeH = Math.min( ( loupeWidth * LOUPE_ASPECT ) / loupeZoom, window.innerHeight );
			const x = Math.max( 0, Math.min( window.innerWidth - edgeW, loupeCursorX - edgeW / 2 ) );
			const y = Math.max( 0, Math.min( window.innerHeight - edgeH, loupeCursorY - edgeH / 2 ) );
			send( { type: 'loupe-snap', x, y, width: edgeW, height: edgeH } );
			flashLoupe();
		},
		true
	);

	document.addEventListener(
		'keydown',
		( e ) => {
			const browserCommand = getBrowserShortcutCommand( e );
			if ( browserCommand ) {
				if ( loupeActive ) deactivateLoupe();
				e.preventDefault();
				e.stopPropagation();
				send( { type: 'browser-command', command: browserCommand } );
				return;
			}
			if ( e.key === loupeHoldKey() ) {
				if ( ! loupeActive && ! e.repeat ) activateLoupe( false );
				return;
			}
			if ( loupeActive && ! loupeSticky ) {
				/* Any other key while holding means a keyboard shortcut, not
				 * loupe use; stand down until the modifier is pressed again. */
				deactivateLoupe();
				return;
			}
			if ( e.key !== 'Escape' ) return;
			if ( loupeActive ) {
				deactivateLoupe();
				return;
			}
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

	document.addEventListener(
		'keyup',
		( e ) => {
			if ( e.key === loupeHoldKey() && loupeActive && ! loupeSticky ) deactivateLoupe();
		},
		true
	);

	window.addEventListener( 'blur', () => {
		if ( loupeActive && ! loupeSticky ) deactivateLoupe();
	} );

	render();
} )();
`;
