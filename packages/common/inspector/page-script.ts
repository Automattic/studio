/**
 * The clip layer: the inspector script injected into the previewed site.
 *
 * One tool, three grains. While the layer is up (hold the primary modifier,
 * or pin it from the host toolbar) the user can:
 * - hover + click an element  -> comment popup -> element clip
 * - drag a marquee            -> region clip (instant, no popup)
 * - scroll to zoom the loupe  -> click snaps the lens region (instant)
 * - press the HUD button      -> page clip
 *
 * Runs in the cross-origin guest page: vanilla DOM inside a Shadow DOM
 * root, no React, no imports. It is written here as a real, type-checked
 * function and *serialized* at injection time (`String( fn )`), so
 * everything it needs must live inside the function body or arrive via the
 * injected config argument. Do not reference module-scope values from
 * inside `inspectorPageMain` — they will not exist in the guest.
 *
 * The guest is stateless about clips: it emits `clip-*` requests over the
 * console bridge and renders whatever numbered markers the host syncs back
 * (`sync-clips`). See `protocol.ts` for the message contract and transport.
 *
 * The loupe magnifies real rendered pixels: the guest can't screenshot
 * itself, so it asks the host for viewport captures (debounced on
 * scroll/resize) and the host pushes them back as data URLs via
 * `window.__studioInspectorBackdrop()`. Cursor tracking stays fully local.
 * Before any capture the host calls `window.__studioInspectorPrepareCapture()`
 * so the overlay hides and can't photograph itself.
 *
 * Layout strategy: markers and highlights are `position: absolute` anchored
 * at *document* coordinates so they scroll with the page for free; the
 * popup, HUD, loupe, and marquee are `position: fixed`.
 */

import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	type InspectorConfig,
	type InspectorInjectedConfig,
} from './protocol';

// Loose window shape for the guest globals this script installs.
interface InspectorGuestWindow extends Window {
	__studioInspectorMounted?: boolean;
	__studioInspectorPrepareCapture?: () => Promise< boolean >;
	__studioInspectorFinishCapture?: () => void;
	__studioInspectorBackdrop?: ( payload: {
		url: string;
		x: number;
		y: number;
		width: number;
		height: number;
	} ) => void;
}

function inspectorPageMain( config: InspectorInjectedConfig ): void {
	const win = window as InspectorGuestWindow;
	if ( win.__studioInspectorMounted ) {
		window.dispatchEvent(
			new CustomEvent( config.commandEvent, { detail: { type: 'report-state' } } )
		);
		return;
	}
	win.__studioInspectorMounted = true;

	const BRIDGE_PREFIX = config.bridgePrefix;
	const COMMAND_EVENT = config.commandEvent;
	const FEATURES = config.features;
	const HOST_ID = '__studio-inspector-host';
	const ACCENT = '#2563eb';
	const AGENT_ACCENT = '#7c3aed';

	const LOUPE_MIN_ZOOM = 1;
	const LOUPE_MAX_ZOOM = 8;
	const LOUPE_MIN_WIDTH = 160;
	const LOUPE_MAX_WIDTH = 480;
	// 16:10 lens.
	const LOUPE_ASPECT = 0.625;
	// Drags shorter than this are clicks, not marquees.
	const MARQUEE_THRESHOLD = 8;

	function send( payload: Record< string, unknown > ): void {
		try {
			console.log( BRIDGE_PREFIX + JSON.stringify( payload ) );
		} catch {
			// JSON.stringify can fail on cycles; the host treats missing
			// messages as no-ops, so swallow rather than crash the page.
		}
	}

	function isApplePlatform(): boolean {
		return /mac|iphone|ipad|ipod/i.test( navigator.platform || navigator.userAgent || '' );
	}

	function holdKey(): string {
		return isApplePlatform() ? 'Meta' : 'Control';
	}

	function isHoldModifierDown( event: MouseEvent | KeyboardEvent ): boolean {
		return isApplePlatform() ? event.metaKey : event.ctrlKey;
	}

	function getBrowserShortcutCommand( event: KeyboardEvent ): string | null {
		if ( event.defaultPrevented || event.repeat || event.shiftKey || event.altKey ) return null;
		if ( ! isHoldModifierDown( event ) ) return null;
		const key = event.key.toLowerCase();
		if ( key === 'r' ) return 'reload';
		if ( key === '[' ) return 'back';
		if ( key === ']' ) return 'forward';
		return null;
	}

	function buildSelector( el: Element | null ): string {
		if ( ! el || el.nodeType !== 1 ) return '';
		if ( ( el as HTMLElement ).id ) return '#' + CSS.escape( ( el as HTMLElement ).id );
		const parts: string[] = [];
		let node: Element | null = el;
		while ( node && node.nodeType === 1 && node !== document.documentElement ) {
			let part = node.tagName.toLowerCase();
			if ( node.classList && node.classList.length ) {
				part += Array.from( node.classList )
					.filter( ( c ) => ! c.startsWith( '__studio-' ) )
					.slice( 0, 3 )
					.map( ( c ) => '.' + CSS.escape( c ) )
					.join( '' );
			}
			const parent: Element | null = node.parentElement;
			if ( parent ) {
				const sameTagSiblings = Array.from( parent.children ).filter(
					( c ) => c.tagName === node!.tagName
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

	function nearbyText( el: Element ): string {
		const text = ( ( el as HTMLElement ).innerText || el.textContent || '' )
			.replace( /\s+/g, ' ' )
			.trim();
		return text.length > 200 ? text.slice( 0, 200 ) + '…' : text;
	}

	function pickComputedStyles( el: Element ): Record< string, string > {
		const cs = window.getComputedStyle( el );
		const keys = [
			'color',
			'background-color',
			'font-size',
			'font-weight',
			'font-family',
			'line-height',
			'padding',
			'margin',
			'border',
			'display',
			'width',
			'height',
		];
		const out: Record< string, string > = {};
		for ( const k of keys ) {
			out[ k ] = cs.getPropertyValue( k );
		}
		return out;
	}

	function documentRectOf( el: Element ) {
		const r = el.getBoundingClientRect();
		return {
			left: r.left + window.scrollX,
			top: r.top + window.scrollY,
			width: r.width,
			height: r.height,
		};
	}

	function viewportRectToDocumentRect( rect: {
		x: number;
		y: number;
		width: number;
		height: number;
	} ) {
		return {
			left: rect.x + window.scrollX,
			top: rect.y + window.scrollY,
			width: rect.width,
			height: rect.height,
		};
	}

	function pageContext() {
		return { url: window.location.href, pathname: window.location.pathname };
	}

	/* ------------------------------------------------------------------
	 * Shadow DOM host. `position: absolute` at the document origin with
	 * zero size anchors absolutely-positioned descendants in document
	 * coordinates, so markers/highlights scroll with the page naturally.
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
	style.textContent = `
		:host { all: initial; }
		* { box-sizing: border-box; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
		.highlight {
			position: absolute; pointer-events: none;
			border: 2px solid ${ ACCENT };
			background: rgba(37,99,235,0.1);
			border-radius: 2px;
		}
		.marker {
			position: absolute; pointer-events: auto; cursor: pointer;
			width: 22px; height: 22px;
			background: ${ ACCENT }; color: #fff;
			border: 2px solid #fff;
			border-radius: 50%;
			box-shadow: 0 2px 6px rgba(0,0,0,0.3);
			font: 700 11px/1 inherit;
			display: inline-flex; align-items: center; justify-content: center;
			transform: translate(-50%, -50%);
		}
		.marker.region { border-radius: 6px; }
		.regionOutline {
			position: absolute; pointer-events: none;
			border: 1.5px dashed ${ ACCENT };
			border-radius: 2px;
			background: rgba(37,99,235,0.05);
		}
		.agentMarker {
			position: absolute; pointer-events: none;
			border: 2px solid ${ AGENT_ACCENT };
			background: rgba(124,58,237,0.12);
			border-radius: 3px;
			animation: __studio-agent-pulse 1.6s ease-in-out infinite;
		}
		.agentMarker .agentLabel {
			position: absolute; top: -26px; left: -2px;
			background: ${ AGENT_ACCENT }; color: #fff;
			font: 600 11px/1 inherit;
			padding: 5px 8px; border-radius: 4px;
			white-space: nowrap;
		}
		@keyframes __studio-agent-pulse {
			0%, 100% { box-shadow: 0 0 0 0 rgba(124,58,237,0.35); }
			50% { box-shadow: 0 0 0 6px rgba(124,58,237,0); }
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
		.popup textarea:focus { border-color: ${ ACCENT }; }
		.popup .actions { display: flex; justify-content: flex-end; gap: 6px; }
		.popup button {
			padding: 6px 12px; border-radius: 16px; border: none;
			font: 600 12px/1 inherit; cursor: pointer;
			white-space: nowrap;
		}
		.popup .delete { background: transparent; color: rgba(255,255,255,0.5); margin-right: auto; }
		.popup .delete:hover { color: #ef4444; }
		.popup .cancel { background: transparent; color: rgba(255,255,255,0.7); }
		.popup .cancel:hover { background: rgba(255,255,255,0.08); }
		.popup .save { background: #fff; color: #1a1a1a; }
		.marquee {
			position: fixed; pointer-events: none; display: none;
			border: 1.5px dashed ${ ACCENT };
			background: rgba(37,99,235,0.08);
		}
		.hud {
			position: fixed; left: 50%; bottom: 16px;
			transform: translateX(-50%);
			display: none; align-items: center; gap: 10px;
			background: rgba(26,26,26,0.92); color: rgba(255,255,255,0.85);
			border-radius: 20px;
			box-shadow: 0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08);
			padding: 7px 8px 7px 14px;
			pointer-events: auto;
			font: 500 11px/1 inherit;
			white-space: nowrap;
		}
		.hud .hints { display: inline-flex; gap: 10px; }
		.hud .hints span b { color: #fff; font-weight: 600; }
		.hud button {
			border: none; cursor: pointer;
			background: rgba(255,255,255,0.12); color: #fff;
			font: 600 11px/1 inherit;
			padding: 6px 10px; border-radius: 14px;
			white-space: nowrap;
		}
		.hud button:hover { background: rgba(255,255,255,0.2); }
		.loupe {
			position: fixed; pointer-events: none; display: none;
			background: #fff;
			outline: 1px solid rgba(0,0,0,0.35);
			box-shadow: 0 8px 32px rgba(0,0,0,0.35);
		}
		.loupe .lensClip {
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
			border: 2px solid ${ ACCENT };
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
		.contextMenu {
			position: fixed; min-width: 200px;
			background: #1a1a1a; color: #fff;
			border-radius: 10px;
			box-shadow: 0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
			padding: 4px;
			pointer-events: auto;
			display: flex; flex-direction: column;
		}
		.contextMenu button {
			border: none; background: transparent; color: #fff;
			font: 500 12px/1 inherit; text-align: left; cursor: pointer;
			padding: 8px 10px; border-radius: 7px;
			white-space: nowrap;
		}
		.contextMenu button:hover { background: rgba(255,255,255,0.1); }
		.submitBar {
			position: fixed; right: 20px; bottom: 20px;
			display: flex; align-items: center; gap: 8px;
			background: rgba(26,26,26,0.95); color: #fff;
			border-radius: 22px;
			box-shadow: 0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08);
			padding: 8px 8px 8px 16px;
			pointer-events: auto;
			font: 500 12px/1 inherit;
			white-space: nowrap;
		}
		.submitBar .count { color: rgba(255,255,255,0.7); }
		.submitBar button {
			border: none; cursor: pointer;
			background: #fff; color: #1a1a1a;
			font: 600 12px/1 inherit;
			padding: 8px 14px; border-radius: 16px;
			white-space: nowrap;
		}
		.submitBar button[disabled] { opacity: 0.4; cursor: default; }
		.submitBar button.toggle {
			background: rgba(255,255,255,0.12); color: #fff;
		}
		.submitBar button.toggle[aria-pressed="true"] {
			background: ${ ACCENT }; color: #fff;
		}
	`;
	root.appendChild( style );

	/* ------------------------------------------------------------------
	 * State
	 * ---------------------------------------------------------------- */
	// The layer: 'off' | 'held' (modifier down) | 'pinned' (toolbar toggle
	// or auto-pinned by opening the comment popup, which needs the
	// modifier-free keyboard).
	let layer: 'off' | 'held' | 'pinned' = 'off';
	let hoveredEl: Element | null = null;
	let cursorX = -1;
	let cursorY = -1;

	// Clips are host-owned; this is the render list from `sync-clips`.
	let clipMarkers: Array< {
		id: string;
		number: number;
		grain: string;
		comment?: string;
		pathname?: string;
		documentRect?: { left: number; top: number; width: number; height: number };
	} > = [];
	let agentMarkers: Array< {
		id: string;
		label?: string;
		selector?: string;
		documentRect?: { left: number; top: number; width: number; height: number };
	} > = [];

	// Comment popup: `pending` for a new element clip, `existing` when
	// opened from a marker.
	let activePopup: {
		existingId?: string;
		comment: string;
		target: {
			selector: string;
			tag: string;
			nearbyText: string;
			computedStyles: Record< string, string >;
		};
		boundingBox: { x: number; y: number; width: number; height: number };
		documentRect: { left: number; top: number; width: number; height: number };
	} | null = null;

	// Marquee drag, in viewport coords.
	let marquee: { startX: number; startY: number; x: number; y: number; active: boolean } | null =
		null;

	// Loupe.
	let loupeZoom = typeof config.initialZoom === 'number' ? config.initialZoom : 3;
	// The lens only materializes once the user scrolls to zoom; at 1x the
	// layer is element highlight + marquee.
	let loupeEngaged = false;
	let loupeWidth = 280;
	let loupeBackdrop: { url: string; x: number; y: number; width: number; height: number } | null =
		null;
	let loupeCaptureTimer: ReturnType< typeof setTimeout > | 0 = 0;
	// True while the host is capturing: the whole overlay hides so it can't
	// photograph itself, and must not re-show until the capture lands.
	let captureHidden = false;

	/* ------------------------------------------------------------------
	 * DOM nodes
	 * ---------------------------------------------------------------- */
	const highlightNode = document.createElement( 'div' );
	highlightNode.className = 'highlight';
	highlightNode.style.display = 'none';
	root.appendChild( highlightNode );

	const marqueeNode = document.createElement( 'div' );
	marqueeNode.className = 'marquee';
	root.appendChild( marqueeNode );

	const markerLayer = document.createElement( 'div' );
	root.appendChild( markerLayer );
	const agentLayer = document.createElement( 'div' );
	root.appendChild( agentLayer );

	let popupNode: HTMLElement | null = null;
	let contextMenuNode: HTMLElement | null = null;

	// HUD: gesture hints + capture-page button, shown while the layer is up.
	const hudNode = document.createElement( 'div' );
	hudNode.className = 'hud';
	const hudHints = document.createElement( 'div' );
	hudHints.className = 'hints';
	hudNode.appendChild( hudHints );
	let hudPageButton: HTMLButtonElement | null = null;
	if ( FEATURES.pageClips ) {
		hudPageButton = document.createElement( 'button' );
		hudPageButton.type = 'button';
		hudPageButton.textContent = 'Capture page';
		hudPageButton.addEventListener( 'click', ( e ) => {
			e.stopPropagation();
			send( { type: 'clip-page' } );
		} );
		hudNode.appendChild( hudPageButton );
	}
	root.appendChild( hudNode );

	// Loupe lens.
	const loupeNode = document.createElement( 'div' );
	loupeNode.className = 'loupe';
	const lensClip = document.createElement( 'div' );
	lensClip.className = 'lensClip';
	const loupeBackdropNode = document.createElement( 'div' );
	loupeBackdropNode.className = 'backdrop';
	lensClip.appendChild( loupeBackdropNode );
	const loupeFlashNode = document.createElement( 'div' );
	loupeFlashNode.className = 'flash';
	const loupeBadgeNode = document.createElement( 'div' );
	loupeBadgeNode.className = 'badge';
	loupeNode.appendChild( lensClip );
	loupeNode.appendChild( loupeFlashNode );
	loupeNode.appendChild( loupeBadgeNode );
	for ( const corner of [ 'tl', 'tr', 'bl', 'br' ] ) {
		const mark = document.createElement( 'div' );
		mark.className = 'corner ' + corner;
		loupeNode.appendChild( mark );
	}
	root.appendChild( loupeNode );

	// CLI standalone submit bar: layer toggle + clip count + submit.
	let submitBarNode: HTMLElement | null = null;
	let submitCountNode: HTMLElement | null = null;
	let submitButtonNode: HTMLButtonElement | null = null;
	let submitToggleNode: HTMLButtonElement | null = null;
	if ( FEATURES.submitToolbar ) {
		submitBarNode = document.createElement( 'div' );
		submitBarNode.className = 'submitBar';
		submitToggleNode = document.createElement( 'button' );
		submitToggleNode.type = 'button';
		submitToggleNode.className = 'toggle';
		submitToggleNode.textContent = 'Clip';
		submitToggleNode.addEventListener( 'click', () => {
			if ( layer === 'pinned' ) {
				exitLayer();
			} else {
				enterLayer( 'pinned' );
			}
		} );
		submitCountNode = document.createElement( 'span' );
		submitCountNode.className = 'count';
		submitButtonNode = document.createElement( 'button' );
		submitButtonNode.type = 'button';
		submitButtonNode.textContent = 'Send to agent';
		submitButtonNode.addEventListener( 'click', () => {
			send( { type: 'submit' } );
		} );
		submitBarNode.appendChild( submitToggleNode );
		submitBarNode.appendChild( submitCountNode );
		submitBarNode.appendChild( submitButtonNode );
		root.appendChild( submitBarNode );
	}

	function isOurElement( el: unknown ): boolean {
		return !! ( el && ( el as Element ).closest && ( el as Element ).closest( '#' + HOST_ID ) );
	}

	/* ------------------------------------------------------------------
	 * Rendering
	 * ---------------------------------------------------------------- */
	function sendState(): void {
		send( {
			type: 'state',
			active: layer !== 'off',
			pinned: layer === 'pinned',
			zoom: loupeZoom,
			clipCount: clipMarkers.length,
		} );
	}

	function renderHighlight(): void {
		const show =
			layer !== 'off' &&
			FEATURES.elementClips &&
			! loupeEngaged &&
			! activePopup &&
			! ( marquee && marquee.active ) &&
			hoveredEl &&
			! captureHidden;
		if ( ! show || ! hoveredEl ) {
			highlightNode.style.display = 'none';
			return;
		}
		const r = documentRectOf( hoveredEl );
		highlightNode.style.display = 'block';
		highlightNode.style.left = r.left + 'px';
		highlightNode.style.top = r.top + 'px';
		highlightNode.style.width = r.width + 'px';
		highlightNode.style.height = r.height + 'px';
	}

	function renderMarkers(): void {
		markerLayer.textContent = '';
		const pathname = window.location.pathname;
		for ( const clip of clipMarkers ) {
			if ( clip.pathname && clip.pathname !== pathname ) continue;
			const rect = clip.documentRect;
			if ( ! rect ) continue;
			if ( clip.grain === 'region' ) {
				const outline = document.createElement( 'div' );
				outline.className = 'regionOutline';
				outline.style.left = rect.left + 'px';
				outline.style.top = rect.top + 'px';
				outline.style.width = rect.width + 'px';
				outline.style.height = rect.height + 'px';
				markerLayer.appendChild( outline );
			}
			const marker = document.createElement( 'div' );
			marker.className = clip.grain === 'region' ? 'marker region' : 'marker';
			marker.style.left = rect.left + rect.width + 'px';
			marker.style.top = rect.top + 'px';
			marker.textContent = String( clip.number );
			marker.title = clip.comment || '';
			marker.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				e.preventDefault();
				openPopupForMarker( clip.id );
			} );
			markerLayer.appendChild( marker );
		}
		renderSubmitBar();
	}

	function renderSubmitBar(): void {
		if ( submitCountNode && submitButtonNode ) {
			const n = clipMarkers.length;
			submitCountNode.textContent =
				n === 0
					? ( isApplePlatform() ? '⌘' : 'Ctrl' ) + '-click an element to clip'
					: n + ( n === 1 ? ' clip' : ' clips' );
			submitButtonNode.disabled = n === 0;
		}
		if ( submitToggleNode ) {
			submitToggleNode.setAttribute( 'aria-pressed', layer === 'pinned' ? 'true' : 'false' );
		}
	}

	function renderAgentMarkers(): void {
		agentLayer.textContent = '';
		for ( const marker of agentMarkers ) {
			let rect = marker.documentRect || null;
			if ( ! rect && marker.selector ) {
				try {
					const el = document.querySelector( marker.selector );
					if ( el ) rect = documentRectOf( el );
				} catch {
					// Invalid selector from the agent: skip the marker.
				}
			}
			if ( ! rect ) continue;
			const node = document.createElement( 'div' );
			node.className = 'agentMarker';
			node.style.left = rect.left + 'px';
			node.style.top = rect.top + 'px';
			node.style.width = rect.width + 'px';
			node.style.height = rect.height + 'px';
			if ( marker.label ) {
				const label = document.createElement( 'div' );
				label.className = 'agentLabel';
				label.textContent = marker.label;
				node.appendChild( label );
			}
			agentLayer.appendChild( node );
		}
	}

	function renderHud(): void {
		const show = layer !== 'off' && ! captureHidden && ! FEATURES.submitToolbar;
		hudNode.style.display = show ? 'inline-flex' : 'none';
		if ( ! show ) return;
		const hints: string[] = [];
		if ( FEATURES.elementClips ) hints.push( '<span><b>Click</b> element</span>' );
		if ( FEATURES.regionClips ) hints.push( '<span><b>Drag</b> region</span>' );
		if ( FEATURES.loupe ) {
			hints.push(
				loupeEngaged
					? '<span><b>Click</b> to snap · <b>Scroll</b> zoom</span>'
					: '<span><b>Scroll</b> zoom</span>'
			);
		}
		hints.push( layer === 'pinned' ? '<span><b>Esc</b> done</span>' : '' );
		hudHints.innerHTML = hints.join( '' );
	}

	function renderCursor(): void {
		if ( layer !== 'off' && ! activePopup ) {
			document.documentElement.style.cursor = loupeEngaged ? 'zoom-in' : 'crosshair';
		} else {
			document.documentElement.style.cursor = '';
		}
	}

	function render(): void {
		renderHighlight();
		renderHud();
		renderCursor();
		renderSubmitBar();
		updateLoupe();
	}

	/* ------------------------------------------------------------------
	 * Layer lifecycle
	 * ---------------------------------------------------------------- */
	function enterLayer( mode: 'held' | 'pinned' ): void {
		const wasOff = layer === 'off';
		if ( layer === 'pinned' && mode === 'held' ) return;
		layer = mode;
		if ( wasOff ) {
			closeContextMenu();
			if ( FEATURES.loupe && loupeEngaged ) sendLoupeCaptureRequest();
		}
		render();
		sendState();
	}

	function exitLayer(): void {
		if ( layer === 'off' ) return;
		layer = 'off';
		hoveredEl = null;
		activePopup = null;
		closePopup();
		cancelMarquee();
		loupeBackdrop = null;
		loupeBackdropNode.style.backgroundImage = '';
		captureHidden = false;
		if ( loupeCaptureTimer ) clearTimeout( loupeCaptureTimer );
		render();
		sendState();
	}

	/* ------------------------------------------------------------------
	 * Comment popup (element clips)
	 * ---------------------------------------------------------------- */
	function closePopup(): void {
		if ( popupNode ) {
			popupNode.remove();
			popupNode = null;
		}
	}

	function openPopup(): void {
		closePopup();
		const state = activePopup;
		if ( ! state ) return;

		// Opening the popup auto-pins the layer: typing a comment needs the
		// modifier-free keyboard, and a held layer would collapse on release.
		if ( layer === 'held' ) {
			layer = 'pinned';
			sendState();
		}

		const popup = document.createElement( 'div' );
		popup.className = 'popup';

		// Near the element, viewport coords (`position: fixed`).
		const r = state.boundingBox;
		const popupWidth = 320;
		const gap = 12;
		const left = Math.min(
			Math.max( 8, r.x + r.width / 2 - popupWidth / 2 ),
			window.innerWidth - popupWidth - 8
		);
		let top = r.y + r.height + gap;
		if ( top + 200 > window.innerHeight ) {
			top = Math.max( 8, r.y - 200 - gap );
		}
		popup.style.left = left + 'px';
		popup.style.top = top + 'px';

		const target = document.createElement( 'div' );
		target.className = 'target';
		target.textContent =
			state.target.tag + ( state.target.nearbyText ? ' — ' + state.target.nearbyText : '' );
		popup.appendChild( target );

		const ta = document.createElement( 'textarea' );
		ta.placeholder = 'What should change here? (optional)';
		ta.value = state.comment || '';
		ta.addEventListener( 'input', () => {
			state.comment = ta.value;
		} );
		ta.addEventListener( 'keydown', ( e ) => {
			// Enter confirms (Shift+Enter for a newline), Escape cancels —
			// both handled here so the page never sees them.
			if ( e.key === 'Enter' && ! e.shiftKey ) {
				e.preventDefault();
				e.stopPropagation();
				confirmPopup();
			}
			if ( e.key === 'Escape' ) {
				e.preventDefault();
				e.stopPropagation();
				dismissPopup();
			}
		} );
		popup.appendChild( ta );
		setTimeout( () => ta.focus(), 0 );

		const actions = document.createElement( 'div' );
		actions.className = 'actions';

		if ( state.existingId ) {
			const del = document.createElement( 'button' );
			del.className = 'delete';
			del.textContent = 'Delete';
			del.addEventListener( 'click', () => {
				const id = state.existingId as string;
				activePopup = null;
				closePopup();
				render();
				send( { type: 'clip-remove', id } );
			} );
			actions.appendChild( del );
		}

		const cancel = document.createElement( 'button' );
		cancel.className = 'cancel';
		cancel.textContent = 'Cancel';
		cancel.addEventListener( 'click', dismissPopup );
		actions.appendChild( cancel );

		const save = document.createElement( 'button' );
		save.className = 'save';
		save.textContent = state.existingId ? 'Update' : 'Add clip';
		save.addEventListener( 'click', confirmPopup );
		actions.appendChild( save );

		popup.appendChild( actions );
		popup.addEventListener( 'click', ( e ) => e.stopPropagation() );
		popup.addEventListener( 'mousedown', ( e ) => e.stopPropagation() );
		popup.addEventListener( 'mousemove', ( e ) => e.stopPropagation() );

		popupNode = popup;
		root.appendChild( popup );
	}

	function dismissPopup(): void {
		activePopup = null;
		closePopup();
		render();
	}

	function confirmPopup(): void {
		const state = activePopup;
		if ( ! state ) return;
		activePopup = null;
		closePopup();
		if ( state.existingId ) {
			send( {
				type: 'clip-update',
				id: state.existingId,
				comment: ( state.comment || '' ).trim(),
			} );
		} else {
			const context = pageContext();
			send( {
				type: 'clip-element',
				clip: {
					comment: ( state.comment || '' ).trim(),
					target: state.target,
					boundingBox: state.boundingBox,
					documentRect: state.documentRect,
					url: context.url,
					pathname: context.pathname,
				},
			} );
		}
		render();
	}

	function openPopupForElement( el: Element ): void {
		const viewport = el.getBoundingClientRect();
		activePopup = {
			comment: '',
			target: {
				selector: buildSelector( el ),
				tag: el.tagName.toLowerCase(),
				nearbyText: nearbyText( el ),
				computedStyles: pickComputedStyles( el ),
			},
			boundingBox: {
				x: viewport.x,
				y: viewport.y,
				width: viewport.width,
				height: viewport.height,
			},
			documentRect: documentRectOf( el ),
		};
		hoveredEl = null;
		openPopup();
		render();
	}

	function openPopupForMarker( id: string ): void {
		const clip = clipMarkers.find( ( c ) => c.id === id );
		if ( ! clip || ! clip.documentRect ) return;
		// Marker edits work with or without the layer; opening one pins it
		// so the popup survives modifier release.
		if ( layer === 'off' ) {
			enterLayer( 'pinned' );
		}
		const rect = clip.documentRect;
		activePopup = {
			existingId: clip.id,
			comment: clip.comment || '',
			target: {
				selector: '',
				tag: clip.grain === 'region' ? 'region' : 'element',
				nearbyText: '',
				computedStyles: {},
			},
			boundingBox: {
				x: rect.left - window.scrollX,
				y: rect.top - window.scrollY,
				width: rect.width,
				height: rect.height,
			},
			documentRect: rect,
		};
		openPopup();
		render();
	}

	/* ------------------------------------------------------------------
	 * Context menu (right-click door into the layer)
	 * ---------------------------------------------------------------- */
	function closeContextMenu(): void {
		if ( contextMenuNode ) {
			contextMenuNode.remove();
			contextMenuNode = null;
		}
	}

	function openContextMenu( x: number, y: number, el: Element | null ): void {
		closeContextMenu();
		const menu = document.createElement( 'div' );
		menu.className = 'contextMenu';

		const addItem = ( label: string, action: () => void ) => {
			const button = document.createElement( 'button' );
			button.type = 'button';
			button.textContent = label;
			button.addEventListener( 'click', ( e ) => {
				e.stopPropagation();
				closeContextMenu();
				action();
			} );
			menu.appendChild( button );
		};

		if ( FEATURES.elementClips && el && ! isOurElement( el ) ) {
			addItem( 'Clip this element', () => {
				enterLayer( 'pinned' );
				openPopupForElement( el );
			} );
		}
		const selection = String( window.getSelection() || '' ).trim();
		if ( FEATURES.contextMenu && selection ) {
			addItem( 'Add selected text to chat', () => {
				const context = pageContext();
				send( {
					type: 'text-selection',
					text: selection.slice( 0, 4000 ),
					url: context.url,
					pathname: context.pathname,
				} );
			} );
		}
		if ( FEATURES.pageClips ) {
			addItem( 'Capture full page', () => send( { type: 'clip-page' } ) );
		}
		if ( ! menu.childNodes.length ) return;

		menu.style.left = Math.min( x, window.innerWidth - 210 ) + 'px';
		menu.style.top = Math.min( y, window.innerHeight - menu.childNodes.length * 34 - 12 ) + 'px';
		menu.addEventListener( 'mousedown', ( e ) => e.stopPropagation() );
		contextMenuNode = menu;
		root.appendChild( menu );
	}

	/* ------------------------------------------------------------------
	 * Marquee (region clips)
	 * ---------------------------------------------------------------- */
	function cancelMarquee(): void {
		marquee = null;
		marqueeNode.style.display = 'none';
	}

	function renderMarquee(): void {
		if ( ! marquee || ! marquee.active ) {
			marqueeNode.style.display = 'none';
			return;
		}
		const x = Math.min( marquee.startX, marquee.x );
		const y = Math.min( marquee.startY, marquee.y );
		const width = Math.abs( marquee.x - marquee.startX );
		const height = Math.abs( marquee.y - marquee.startY );
		marqueeNode.style.display = 'block';
		marqueeNode.style.left = x + 'px';
		marqueeNode.style.top = y + 'px';
		marqueeNode.style.width = width + 'px';
		marqueeNode.style.height = height + 'px';
	}

	function finishMarquee(): void {
		if ( ! marquee ) return;
		const rect = {
			x: Math.max( 0, Math.min( marquee.startX, marquee.x ) ),
			y: Math.max( 0, Math.min( marquee.startY, marquee.y ) ),
			width: Math.abs( marquee.x - marquee.startX ),
			height: Math.abs( marquee.y - marquee.startY ),
		};
		cancelMarquee();
		if ( rect.width < MARQUEE_THRESHOLD || rect.height < MARQUEE_THRESHOLD ) return;
		rect.width = Math.min( rect.width, window.innerWidth - rect.x );
		rect.height = Math.min( rect.height, window.innerHeight - rect.y );
		let covered: Element | null = null;
		try {
			covered = document
				.elementsFromPoint( rect.x + rect.width / 2, rect.y + rect.height / 2 )
				.filter( ( el ) => ! isOurElement( el ) )[ 0 ] as Element | null;
		} catch {
			covered = null;
		}
		const context = pageContext();
		send( {
			type: 'clip-region',
			clip: {
				rect,
				documentRect: viewportRectToDocumentRect( rect ),
				zoom: 1,
				coveredTag: covered ? covered.tagName.toLowerCase() : undefined,
				coveredSelector: covered ? buildSelector( covered ) : undefined,
				url: context.url,
				pathname: context.pathname,
			},
		} );
		render();
	}

	/* ------------------------------------------------------------------
	 * Loupe
	 * ---------------------------------------------------------------- */
	function sendLoupeCaptureRequest(): void {
		// The host captures the whole visible viewport; docX/docY anchor it
		// in document coordinates (echoed back with the capture).
		send( {
			type: 'loupe-capture',
			docX: window.scrollX,
			docY: window.scrollY,
			width: window.innerWidth,
			height: window.innerHeight,
		} );
	}

	function scheduleLoupeCapture(): void {
		if ( loupeCaptureTimer ) clearTimeout( loupeCaptureTimer );
		loupeCaptureTimer = setTimeout( sendLoupeCaptureRequest, 120 );
	}

	function updateLoupe(): void {
		const show = layer !== 'off' && FEATURES.loupe && loupeEngaged && ! captureHidden;
		if ( ! show || cursorX < 0 || cursorY < 0 ) {
			loupeNode.style.display = 'none';
			return;
		}
		const lw = loupeWidth;
		const lh = Math.round( loupeWidth * LOUPE_ASPECT );
		// Avoid-mouse placement: above-right of the cursor, flipping near
		// window edges so the lens never sits under the pointer.
		let left = cursorX + 20;
		let top = cursorY - lh - 20;
		if ( left + lw > window.innerWidth - 8 ) left = cursorX - lw - 20;
		if ( top < 8 ) top = cursorY + 20;
		left = Math.max( 8, Math.min( window.innerWidth - lw - 8, left ) );
		top = Math.max( 8, Math.min( window.innerHeight - lh - 12, top ) );
		loupeNode.style.display = 'block';
		loupeNode.style.width = lw + 'px';
		loupeNode.style.height = lh + 'px';
		loupeNode.style.left = left + 'px';
		loupeNode.style.top = top + 'px';
		loupeBadgeNode.textContent = Math.round( loupeZoom * 10 ) / 10 + '×';
		if ( loupeBackdrop ) {
			// Keep the page point under the cursor at the lens centre.
			const docX = cursorX + window.scrollX;
			const docY = cursorY + window.scrollY;
			const tx = lw / 2 - ( docX - loupeBackdrop.x ) * loupeZoom;
			const ty = lh / 2 - ( docY - loupeBackdrop.y ) * loupeZoom;
			loupeBackdropNode.style.transform =
				'translate(' + tx + 'px, ' + ty + 'px) scale(' + loupeZoom + ')';
		}
	}

	function engageLoupe(): void {
		if ( ! FEATURES.loupe || loupeEngaged ) return;
		loupeEngaged = true;
		hoveredEl = null;
		sendLoupeCaptureRequest();
		render();
	}

	function disengageLoupe(): void {
		if ( ! loupeEngaged ) return;
		loupeEngaged = false;
		render();
	}

	function flashLoupe(): void {
		loupeFlashNode.style.transition = 'none';
		loupeFlashNode.style.opacity = '0.85';
		requestAnimationFrame( () => {
			requestAnimationFrame( () => {
				loupeFlashNode.style.transition = 'opacity 0.35s ease';
				loupeFlashNode.style.opacity = '0';
			} );
		} );
	}

	function snapLoupeLens(): void {
		if ( cursorX < 0 || cursorY < 0 ) return;
		// Snap the content visible in the lens: a lens-shaped rect centred
		// on the cursor, `lens size / zoom` CSS px wide, clamped so the crop
		// stays capturable.
		const edgeW = Math.min( loupeWidth / loupeZoom, window.innerWidth );
		const edgeH = Math.min( ( loupeWidth * LOUPE_ASPECT ) / loupeZoom, window.innerHeight );
		const x = Math.max( 0, Math.min( window.innerWidth - edgeW, cursorX - edgeW / 2 ) );
		const y = Math.max( 0, Math.min( window.innerHeight - edgeH, cursorY - edgeH / 2 ) );
		const rect = { x, y, width: edgeW, height: edgeH };
		let covered: Element | null = null;
		try {
			covered = document
				.elementsFromPoint( cursorX, cursorY )
				.filter( ( el ) => ! isOurElement( el ) )[ 0 ] as Element | null;
		} catch {
			covered = null;
		}
		const context = pageContext();
		send( {
			type: 'clip-region',
			clip: {
				rect,
				documentRect: viewportRectToDocumentRect( rect ),
				zoom: loupeZoom,
				coveredTag: covered ? covered.tagName.toLowerCase() : undefined,
				coveredSelector: covered ? buildSelector( covered ) : undefined,
				url: context.url,
				pathname: context.pathname,
			},
		} );
		flashLoupe();
	}

	/* ------------------------------------------------------------------
	 * Capture hiding hooks (installed for the host)
	 * ---------------------------------------------------------------- */
	// Called by the host just before every capture (backdrops, clip crops,
	// page clips). Hides the overlay and resolves after the hidden frame
	// has had a chance to paint, so captures never contain the overlay.
	win.__studioInspectorPrepareCapture = () => {
		captureHidden = true;
		highlightNode.style.display = 'none';
		marqueeNode.style.display = 'none';
		hudNode.style.display = 'none';
		loupeNode.style.display = 'none';
		markerLayer.style.display = 'none';
		agentLayer.style.display = 'none';
		if ( popupNode ) popupNode.style.display = 'none';
		if ( submitBarNode ) submitBarNode.style.display = 'none';
		return new Promise< boolean >( ( resolve ) => {
			requestAnimationFrame( () => {
				requestAnimationFrame( () => resolve( true ) );
			} );
		} );
	};

	// Called by the host after a capture that doesn't push a backdrop
	// (clip crops, page clips, failures) to bring the overlay back.
	win.__studioInspectorFinishCapture = () => {
		captureHidden = false;
		markerLayer.style.display = '';
		agentLayer.style.display = '';
		if ( popupNode ) popupNode.style.display = '';
		if ( submitBarNode ) submitBarNode.style.display = '';
		render();
	};

	win.__studioInspectorBackdrop = ( payload ) => {
		captureHidden = false;
		markerLayer.style.display = '';
		agentLayer.style.display = '';
		if ( popupNode ) popupNode.style.display = '';
		if ( submitBarNode ) submitBarNode.style.display = '';
		if ( ! payload || typeof payload.url !== 'string' ) {
			render();
			return;
		}
		loupeBackdrop = payload;
		loupeBackdropNode.style.backgroundImage = 'url("' + payload.url + '")';
		loupeBackdropNode.style.width = payload.width + 'px';
		loupeBackdropNode.style.height = payload.height + 'px';
		render();
	};

	/* ------------------------------------------------------------------
	 * Host commands
	 * ---------------------------------------------------------------- */
	window.addEventListener( COMMAND_EVENT, ( event ) => {
		const command = ( event as CustomEvent ).detail || {};
		switch ( command.type ) {
			case 'layer-hold-start':
				// Idempotent; never demotes a pinned layer.
				if ( layer === 'off' ) enterLayer( 'held' );
				return;
			case 'layer-hold-end':
				if ( layer === 'held' ) exitLayer();
				return;
			case 'layer-toggle':
				if ( layer === 'pinned' ) {
					exitLayer();
				} else {
					enterLayer( 'pinned' );
				}
				return;
			case 'layer-off':
				exitLayer();
				return;
			case 'set-zoom':
				if ( typeof command.zoom === 'number' && isFinite( command.zoom ) ) {
					loupeZoom = Math.max( LOUPE_MIN_ZOOM, Math.min( LOUPE_MAX_ZOOM, command.zoom ) );
					updateLoupe();
				}
				return;
			case 'refresh-backdrop':
				if ( layer !== 'off' && loupeEngaged ) sendLoupeCaptureRequest();
				return;
			case 'sync-clips':
				clipMarkers = Array.isArray( command.clips ) ? command.clips : [];
				renderMarkers();
				sendState();
				return;
			case 'agent-markers':
				agentMarkers = Array.isArray( command.markers ) ? command.markers : [];
				renderAgentMarkers();
				return;
			case 'report-state':
				sendState();
				return;
		}
	} );

	/* ------------------------------------------------------------------
	 * Pointer interactions
	 * ---------------------------------------------------------------- */
	document.addEventListener(
		'mousemove',
		( e ) => {
			cursorX = e.clientX;
			cursorY = e.clientY;
			if ( layer === 'off' ) return;
			// Self-heal a lost keyup (modifier released outside the window):
			// every mouse event carries the live modifier state.
			if ( layer === 'held' && ! isHoldModifierDown( e ) ) {
				exitLayer();
				return;
			}
			if ( marquee ) {
				marquee.x = e.clientX;
				marquee.y = e.clientY;
				if (
					! marquee.active &&
					( Math.abs( marquee.x - marquee.startX ) > MARQUEE_THRESHOLD ||
						Math.abs( marquee.y - marquee.startY ) > MARQUEE_THRESHOLD )
				) {
					marquee.active = true;
					hoveredEl = null;
					renderHighlight();
				}
				renderMarquee();
				return;
			}
			if ( loupeEngaged ) {
				updateLoupe();
				return;
			}
			if ( ! FEATURES.elementClips || activePopup ) return;
			if ( isOurElement( e.target ) ) {
				if ( hoveredEl !== null ) {
					hoveredEl = null;
					renderHighlight();
				}
				return;
			}
			if ( hoveredEl !== e.target ) {
				hoveredEl = e.target as Element;
				renderHighlight();
			}
		},
		true
	);

	document.addEventListener(
		'mousedown',
		( e ) => {
			if ( contextMenuNode && ! isOurElement( e.target ) ) closeContextMenu();
			if ( layer === 'off' || activePopup ) return;
			if ( isOurElement( e.target ) ) return;
			if ( e.button !== 0 ) return;
			e.preventDefault();
			e.stopPropagation();
			if ( loupeEngaged ) return;
			if ( ! FEATURES.regionClips ) return;
			marquee = { startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false };
		},
		true
	);

	document.addEventListener(
		'mouseup',
		( e ) => {
			if ( layer === 'off' || ! marquee ) return;
			if ( e.button !== 0 ) return;
			const wasActive = marquee.active;
			e.preventDefault();
			e.stopPropagation();
			if ( wasActive ) {
				finishMarquee();
			} else {
				cancelMarquee();
			}
		},
		true
	);

	document.addEventListener(
		'click',
		( e ) => {
			if ( layer === 'off' ) return;
			if ( isOurElement( e.target ) ) return;
			e.preventDefault();
			e.stopPropagation();
			if ( activePopup ) {
				// A click on the page while the popup is open dismisses it.
				dismissPopup();
				return;
			}
			if ( loupeEngaged ) {
				snapLoupeLens();
				return;
			}
			if ( FEATURES.elementClips && e.target ) {
				openPopupForElement( e.target as Element );
			}
		},
		true
	);

	document.addEventListener(
		'mouseleave',
		() => {
			cursorX = -1;
			cursorY = -1;
			if ( layer !== 'off' ) updateLoupe();
		},
		true
	);

	if ( FEATURES.contextMenu ) {
		document.addEventListener(
			'contextmenu',
			( e ) => {
				if ( isOurElement( e.target ) ) return;
				e.preventDefault();
				e.stopPropagation();
				openContextMenu( e.clientX, e.clientY, e.target as Element | null );
			},
			true
		);
	}

	/* ------------------------------------------------------------------
	 * Wheel: zoom the loupe (shift+wheel resizes the lens). Zooming past
	 * 1x materializes the lens; zooming back to 1x returns to the
	 * element/region grains.
	 * ---------------------------------------------------------------- */
	window.addEventListener(
		'wheel',
		( e ) => {
			if ( layer === 'off' || ! FEATURES.loupe || activePopup ) return;
			e.preventDefault();
			const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
			if ( e.shiftKey ) {
				loupeWidth = Math.max(
					LOUPE_MIN_WIDTH,
					Math.min( LOUPE_MAX_WIDTH, loupeWidth - delta * 0.5 )
				);
				updateLoupe();
				return;
			}
			if ( ! loupeEngaged ) {
				if ( delta < 0 ) {
					// First zoom-in tick jumps to the remembered zoom level.
					engageLoupe();
				}
				return;
			}
			// No recapture needed: the backdrop is a native-resolution
			// viewport capture magnified by a compositor transform.
			const nextZoom = Math.max(
				LOUPE_MIN_ZOOM,
				Math.min( LOUPE_MAX_ZOOM, loupeZoom * Math.exp( -delta * 0.003 ) )
			);
			if ( nextZoom <= LOUPE_MIN_ZOOM + 0.05 && delta > 0 ) {
				loupeZoom = Math.max( 2, loupeZoom );
				disengageLoupe();
				sendState();
				return;
			}
			loupeZoom = nextZoom;
			updateLoupe();
			sendState();
		},
		{ capture: true, passive: false }
	);

	window.addEventListener(
		'scroll',
		() => {
			if ( layer === 'off' ) return;
			renderHighlight();
			if ( loupeEngaged ) {
				updateLoupe();
				scheduleLoupeCapture();
			}
		},
		{ capture: true, passive: true }
	);

	window.addEventListener( 'resize', () => {
		if ( layer === 'off' ) return;
		if ( loupeEngaged ) {
			updateLoupe();
			scheduleLoupeCapture();
		}
	} );

	/* ------------------------------------------------------------------
	 * Keyboard
	 * ---------------------------------------------------------------- */
	document.addEventListener(
		'keydown',
		( e ) => {
			if ( FEATURES.browserShortcuts ) {
				const browserCommand = getBrowserShortcutCommand( e );
				if ( browserCommand ) {
					if ( layer === 'held' ) exitLayer();
					e.preventDefault();
					e.stopPropagation();
					send( { type: 'browser-command', command: browserCommand } );
					return;
				}
			}
			if ( e.key === holdKey() ) {
				if ( layer === 'off' && ! e.repeat && ! activePopup ) enterLayer( 'held' );
				return;
			}
			if ( e.key === 'Escape' ) {
				if ( contextMenuNode ) {
					closeContextMenu();
					return;
				}
				if ( activePopup ) {
					dismissPopup();
					return;
				}
				if ( marquee ) {
					cancelMarquee();
					return;
				}
				if ( loupeEngaged ) {
					disengageLoupe();
					return;
				}
				if ( layer !== 'off' ) {
					exitLayer();
				}
				return;
			}
			// Any other key while holding means a keyboard shortcut, not
			// layer use; stand down until the modifier is pressed again.
			if ( layer === 'held' && ! activePopup ) {
				exitLayer();
			}
		},
		true
	);

	document.addEventListener(
		'keyup',
		( e ) => {
			if ( e.key === holdKey() && layer === 'held' ) exitLayer();
		},
		true
	);

	window.addEventListener( 'blur', () => {
		if ( layer === 'held' ) exitLayer();
	} );

	renderMarkers();
	renderAgentMarkers();
	sendState();
}

/**
 * Serializes the page function into a self-contained program string for
 * `webview.executeJavaScript()` / Playwright's `page.evaluate()`.
 *
 * The `__name` shim covers esbuild's `keepNames` helper: if the bundler
 * compiled this module with keep-names on, the serialized body contains
 * `__name(...)` calls that would otherwise be dangling in the guest.
 */
export function buildInspectorPageScript( config: InspectorConfig ): string {
	const injected: InspectorInjectedConfig = {
		...config,
		bridgePrefix: INSPECTOR_BRIDGE_PREFIX,
		commandEvent: INSPECTOR_COMMAND_EVENT,
	};
	return [
		'( () => {',
		'var __name = ( target, name ) => { try { Object.defineProperty( target, "name", { value: name, configurable: true } ); } catch {} return target; };',
		`( ${ String( inspectorPageMain ) } )( ${ JSON.stringify( injected ) } );`,
		'} )();',
	].join( '\n' );
}
