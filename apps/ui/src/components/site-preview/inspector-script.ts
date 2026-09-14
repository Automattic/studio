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
	/* A stale instance can outlive its host element (the mount flag is per
	 * document, its listeners are not), so retire it before taking over. */
	if ( typeof window.__studioInspectorDispose === 'function' ) {
		window.__studioInspectorDispose();
	}
	window.__studioInspectorMounted = true;
	const teardown = new AbortController();

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
		if ( event.shiftKey ) {
			if ( key === 'f' ) return 'full-preview';
			return key === 'r' ? 'reload' : null;
		}
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

	window.__studioInspectorDispose = () => {
		teardown.abort();
		host.remove();
		delete window.__studioInspectorMounted;
		delete window.__studioInspectorDispose;
	};

	const style = document.createElement( 'style' );
	style.textContent = ` +
	'`' +
	String.raw`
		:host { all: initial; }
		* { box-sizing: border-box; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
		.highlight {
			position: absolute; pointer-events: none;
			border: 2px solid #7c3aed;
			background: rgba(124,58,237,0.12);
			border-radius: 2px;
			z-index: 2;
		}
		/* Four viewport-fixed panels around the element being annotated,
		   so the rest of the page dims and the selection reads as isolated.
		   Sits above the markers, below the highlight and popup. */
		.scrim {
			position: fixed; pointer-events: none;
			background: rgba(0,0,0,0.52);
			z-index: 1;
		}
		.marker {
			position: absolute; pointer-events: auto; cursor: pointer;
			width: 22px; height: 22px;
			background: #7c3aed; color: #fff;
			border: 2px solid #fff;
			border-radius: 50%;
			box-shadow: 0 2px 6px rgba(0,0,0,0.3);
			font: 700 11px/1 inherit;
			display: inline-flex; align-items: center; justify-content: center;
			transform: translate(-50%, -50%);
		}
		.marker.otherViewport { opacity: 0.55; border-style: dashed; }
		.popup {
			position: fixed; width: min(320px, calc(100vw - 16px)); z-index: 3;
			background: #1a1a1a; color: #fff;
			border-radius: 12px;
			box-shadow: 0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08);
			padding: 12px;
			pointer-events: auto;
			display: flex; flex-direction: column; gap: 8px;
		}
		.popup .target {
			display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
			font-size: 11px; color: rgba(255,255,255,0.5);
		}
		.popup .target .element {
			min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.popup .target .element code {
			font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: rgba(255,255,255,0.7);
		}
		.popup .target .viewport { flex: 0 0 auto; white-space: nowrap; }
		.popup textarea {
			width: 100%; min-height: 72px; resize: vertical;
			background: rgba(255,255,255,0.05); color: #fff;
			border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
			padding: 8px; font: 13px/1.4 inherit; outline: none;
		}
		.popup textarea:focus { border-color: #7c3aed; }
		.popup .actions { display: flex; justify-content: flex-end; gap: 4px; }
		/* Sized so Delete/Cancel/Update/Send to chat all fit one row of the
		   320px popup; nowrap keeps a tight fit from wrapping a label onto a
		   second line instead of the row overflowing visibly. */
		.popup button {
			padding: 6px 8px; border-radius: 16px; border: none;
			font: 600 11px/1 inherit; white-space: nowrap; cursor: pointer;
		}
		.popup .delete { background: transparent; color: rgba(255,255,255,0.5); margin-right: auto; }
		.popup .delete:hover { color: #ef4444; }
		.popup .cancel { background: transparent; color: rgba(255,255,255,0.7); }
		.popup .cancel:hover { background: rgba(255,255,255,0.08); }
		.popup .save { background: #fff; color: #1a1a1a; }
		.popup .save[disabled] { opacity: 0.4; cursor: default; }
		.popup .submit { background: #7c3aed; color: #fff; }
		.popup .submit:hover:not([disabled]) { background: #6d28d9; }
		.popup .submit[disabled] { opacity: 0.4; cursor: default; }
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
	const scrimNodes = [];
	let highlightNode = null;
	let highlightEl = null;
	let popupNode = null;

	/* Width of the viewport a note was made in vs. now. Beyond this the pin
	 * is drawn muted so it reads as "from another viewport". */
	const OTHER_VIEWPORT_TOLERANCE = 48;

	function resolveAnnotationElement( ann ) {
		if ( ! ann || ! ann.selector ) return null;
		try {
			return document.querySelector( ann.selector );
		} catch {
			return null;
		}
	}

	function positionMarker( marker, ann ) {
		/* Re-measure from the live element when it can be found: the page
		 * reflows when the viewport changes, and a rect captured at save
		 * time would leave the pin stranded. Fall back to the saved rect. */
		const el = resolveAnnotationElement( ann );
		const box = el
			? documentRect( el )
			: ann.documentRect || ann.boundingBox || { left: 0, top: 0, width: 0, height: 0 };
		marker.style.left = box.left + box.width + 'px';
		marker.style.top = box.top + 'px';
		const madeAt = ann.viewport && ann.viewport.width;
		const other = !! madeAt && Math.abs( madeAt - window.innerWidth ) > OTHER_VIEWPORT_TOLERANCE;
		marker.classList.toggle( 'otherViewport', other );
		marker.title = other ? ann.comment + ' (' + madeAt + 'px wide)' : ann.comment;
	}

	function persistAnnotations() {
		window.__studioInspectorState = annotations;
		send( { type: 'annotations-updated', annotations: annotations.slice() } );
	}

	function sendState() {
		send( {
			type: 'state',
			isPicking,
			annotationCount: annotations.length,
			hasUnsavedDraft: hasDraft(),
		} );
	}

	function syncMarkers() {
		const currentPath = window.location.pathname + window.location.search;
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
			const onCurrentPage = ! ann.path || ann.path === currentPath;
			let marker = markerNodes.get( ann.id );
			if ( ! onCurrentPage ) {
				if ( marker ) {
					marker.remove();
					markerNodes.delete( ann.id );
				}
				return;
			}
			if ( ! marker ) {
				marker = document.createElement( 'div' );
				marker.className = 'marker';
				marker.addEventListener( 'click', ( e ) => {
					e.stopPropagation();
					const current = annotations.find( ( a ) => a.id === ann.id );
					if ( current ) openPopupForAnnotation( current );
				} );
				root.appendChild( marker );
				markerNodes.set( ann.id, marker );
			}
			marker.textContent = String( idx + 1 );
			positionMarker( marker, ann );
		} );
	}

	/* Markers and the highlight live in document coordinates, which follow
	 * scrolling for free but not reflow. Re-measure everything after the
	 * viewport changes (responsive presets, pane resizes) so pins stay on
	 * their elements and a highlight sized for a wide layout can't stretch
	 * a narrow one. */
	let relayoutFrame = 0;
	function relayout() {
		if ( relayoutFrame ) return;
		relayoutFrame = requestAnimationFrame( () => {
			relayoutFrame = 0;
			annotations.forEach( ( ann ) => {
				const marker = markerNodes.get( ann.id );
				if ( marker ) positionMarker( marker, ann );
			} );
			if ( highlightNode && highlightEl ) {
				placeHighlight( highlightEl );
			}
			if ( popupNode && activePopup ) {
				positionPopup( popupNode, activePopup.target );
			}
			syncScrim();
		} );
	}
	window.addEventListener( 'resize', relayout, { signal: teardown.signal } );
	/* The scrim is viewport-fixed while its hole is a document rect, so it
	 * has to be re-cut on every scroll, not just on reflow. */
	window.addEventListener( 'scroll', syncScrim, { capture: true, signal: teardown.signal } );
	const reflowObserver =
		typeof ResizeObserver === 'function' ? new ResizeObserver( relayout ) : null;
	if ( reflowObserver ) reflowObserver.observe( document.documentElement );
	teardown.signal.addEventListener( 'abort', () => {
		if ( reflowObserver ) reflowObserver.disconnect();
		if ( relayoutFrame ) cancelAnimationFrame( relayoutFrame );
	} );

	function placeHighlight( el ) {
		const r = documentRect( el );
		highlightNode.style.left = r.left + 'px';
		highlightNode.style.top = r.top + 'px';
		highlightNode.style.width = r.width + 'px';
		highlightNode.style.height = r.height + 'px';
	}

	function showHighlight( el ) {
		if ( highlightNode ) {
			highlightNode.remove();
			highlightNode = null;
			highlightEl = null;
		}
		if ( ! el || ! isPicking ) return;
		highlightEl = el;
		highlightNode = document.createElement( 'div' );
		highlightNode.className = 'highlight';
		placeHighlight( el );
		root.appendChild( highlightNode );
	}

	function resolveTargetRect( target ) {
		let el = null;
		try {
			el = target.selector ? document.querySelector( target.selector ) : null;
		} catch {}
		return el ? documentRect( el ) : target.documentRect || target.boundingBox || null;
	}

	function syncScrim() {
		const rect = activePopup ? resolveTargetRect( activePopup.target ) : null;
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
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const left = Math.min( vw, Math.max( 0, rect.left - window.scrollX ) );
		const top = Math.min( vh, Math.max( 0, rect.top - window.scrollY ) );
		const right = Math.min( vw, Math.max( left, rect.left + rect.width - window.scrollX ) );
		const bottom = Math.min( vh, Math.max( top, rect.top + rect.height - window.scrollY ) );
		const panels = [
			{ left: 0, top: 0, width: vw, height: top },
			{ left: 0, top: bottom, width: vw, height: vh - bottom },
			{ left: 0, top, width: left, height: bottom - top },
			{ left: right, top, width: vw - right, height: bottom - top },
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
		syncMarkers();
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
			annotations = annotations.concat( [
				{
					id: uid(),
					comment: trimmed,
					selector: state.target.selector,
					tag: state.target.tag,
					classes: state.target.classes,
					nearbyText: state.target.nearbyText,
					boundingBox: state.target.boundingBox,
					documentRect: state.target.documentRect,
					computedStyles: state.target.computedStyles,
					viewport: { width: window.innerWidth, height: window.innerHeight },
					path: window.location.pathname + window.location.search,
					url: window.location.href,
					timestamp: Date.now(),
				},
			] );
		}
		persistAnnotations();
		return true;
	}

	function hasDraft() {
		return !! ( activePopup && ( activePopup.comment || '' ).trim() );
	}

	function submitAnnotations() {
		if ( annotations.length === 0 && ! hasDraft() ) {
			sendState();
			return;
		}
		/* An untouched popup is a draft the user never filled in — drop it
		 * rather than blocking the notes they did save. */
		if ( hasDraft() ) {
			commitActivePopup();
		} else {
			activePopup = null;
		}
		send( { type: 'done', annotations: annotations.slice() } );
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

	window.addEventListener(
		COMMAND_EVENT,
		( event ) => {
			const command = event.detail || {};
			if ( command.type === 'cancel' ) {
				cancelAnnotations();
				return;
			}
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
		},
		{ signal: teardown.signal }
	);

	/* Position the popup near the element using viewport coords (it's
	 * \`position: fixed\` so it stays in the viewport). Falls back to
	 * centre if the element can't be located. Re-run on relayout. */
	function positionPopup( popup, target ) {
		const el = resolveAnnotationElement( target );
		if ( el ) {
			const r = el.getBoundingClientRect();
			const popupWidth = Math.min( 320, window.innerWidth - 16 );
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
			popup.style.transform = '';
		} else {
			popup.style.left = '50%';
			popup.style.top = '50%';
			popup.style.transform = 'translate(-50%, -50%)';
		}
	}

	function buildPopup( state ) {
		const popup = document.createElement( 'div' );
		popup.className = 'popup';

		positionPopup( popup, state.target );

		const target = document.createElement( 'div' );
		target.className = 'target';
		const element = document.createElement( 'span' );
		element.className = 'element';
		const tagCode = document.createElement( 'code' );
		const classes = state.target.classes || [];
		tagCode.textContent = '<' + state.target.tag + '>';
		/* Class lists are often long; keep the line for the content and show
		 * the full opening tag on hover instead. */
		tagCode.title =
			'<' + state.target.tag + ( classes.length ? ' class="' + classes.join( ' ' ) + '"' : '' ) + '>';
		element.appendChild( tagCode );
		if ( state.target.nearbyText ) {
			element.appendChild( document.createTextNode( ' ' + state.target.nearbyText ) );
		}
		element.title = state.target.nearbyText || '';
		target.appendChild( element );

		/* A saved note keeps the viewport it was made in; a new one reports
		 * the current one, which is what gets stamped on save. */
		const vp = state.viewport || { width: window.innerWidth, height: window.innerHeight };
		const viewportSpan = document.createElement( 'span' );
		viewportSpan.className = 'viewport';
		viewportSpan.textContent = vp.width + '×' + vp.height;
		viewportSpan.title = 'Viewport when annotated';
		target.appendChild( viewportSpan );
		popup.appendChild( target );

		state.comment = state.comment || '';
		const ta = document.createElement( 'textarea' );
		ta.placeholder = 'What should change about this element?';
		ta.value = state.comment;
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
		save.addEventListener( 'click', () => {
			if ( ! commitActivePopup() ) return;
			closePopup();
		} );
		actions.appendChild( save );

		const submit = document.createElement( 'button' );
		submit.className = 'submit';
		submit.textContent = 'Send to chat';
		submit.addEventListener( 'click', submitAnnotations );
		actions.appendChild( submit );

		function syncActions() {
			save.disabled = ! state.comment.trim();
			/* Sending stays available while notes are already saved, even if
			 * this popup is an untouched draft — submit discards it. */
			submit.disabled = save.disabled && annotations.length === 0;
		}
		syncActions();

		ta.addEventListener( 'input', () => {
			state.comment = ta.value;
			syncActions();
			sendState();
		} );
		ta.addEventListener( 'keydown', ( event ) => {
			if ( event.key !== 'Enter' || event.isComposing || event.keyCode === 229 ) return;
			if ( event.metaKey || event.ctrlKey ) {
				event.preventDefault();
				const start = ta.selectionStart;
				const end = ta.selectionEnd;
				ta.value = ta.value.slice( 0, start ) + '\n' + ta.value.slice( end );
				state.comment = ta.value;
				ta.setSelectionRange( start + 1, start + 1 );
				syncActions();
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

	/* Editing an existing note leaves picking mode alone: markers stay
	 * clickable when picking is off, and silently switching it on would
	 * swallow every subsequent link click in the page. */
	function openPopupForAnnotation( ann ) {
		hoveredEl = null;
		activePopup = {
			id: ann.id,
			comment: ann.comment,
			viewport: ann.viewport,
			target: {
				selector: ann.selector,
				tag: ann.tag,
				classes: ann.classes,
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
		activePopup = {
			fromPicker: true,
			comment: '',
			target: {
				selector: buildSelector( el ),
				tag: el.tagName.toLowerCase(),
				classes: Array.from( el.classList || [] ).filter( ( c ) => ! c.startsWith( '__studio-' ) ),
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
		{ capture: true, signal: teardown.signal }
	);

	document.addEventListener(
		'click',
		( e ) => {
			if ( ! isPicking || activePopup ) return;
			if ( isOurElement( e.target ) ) return;
			e.preventDefault();
			e.stopPropagation();
			openPopupForElement( e.target );
		},
		{ capture: true, signal: teardown.signal }
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
				e.preventDefault();
				e.stopPropagation();
				activePopup = null;
				persistAnnotations();
				sendState();
				render();
			} else if ( isPicking ) {
				e.preventDefault();
				e.stopPropagation();
				send( { type: 'cancel-requested' } );
			}
		},
		{ capture: true, signal: teardown.signal }
	);

	render();
} )();
`;
