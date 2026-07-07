/**
 * Bridge protocol between the injected inspector page script (the "clip
 * layer") and whichever host is driving it — the Electron `<webview>` in
 * apps/ui or the Playwright page in apps/cli.
 *
 * Transport, in both directions:
 * - guest -> host: a structured `console.log` line, `BRIDGE_PREFIX + JSON`.
 *   The Electron host receives it via the webview's `console-message` event;
 *   the CLI host via Playwright's `page.on( 'console' )`.
 * - host -> guest: a CustomEvent named `INSPECTOR_COMMAND_EVENT` dispatched
 *   on the guest `window` (via `executeJavaScript` / `page.evaluate`).
 *
 * The guest never owns clips: it emits clip requests and renders whatever
 * markers the host syncs back with `sync-clips`. That keeps a single source
 * of truth (the composer in the app; the CLI process in the terminal flow)
 * and lets either side remove a clip without the two drifting apart.
 */

export const INSPECTOR_BRIDGE_PREFIX = '__studio-inspector__:';
export const INSPECTOR_COMMAND_EVENT = '__studio-inspector-command';

/** How granular a clip is. `element` is semantic (selector + styles + an
 * image crop); `region` and `page` are pixel grabs; `console` is a log
 * export created host-side (it never originates in the guest). */
export type ClipGrain = 'element' | 'region' | 'page' | 'console';

/** Viewport-relative rect in CSS px. */
export interface ClipViewportRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Document-coordinate rect in CSS px (viewport rect + scroll offset). */
export interface ClipDocumentRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface ClipElementTarget {
	selector: string;
	tag: string;
	nearbyText: string;
	computedStyles: Record< string, string >;
}

/** Page-local metadata every guest-originated clip request carries. */
export interface ClipPageContext {
	url: string;
	pathname: string;
}

/** An element clip request assembled in the guest when the user confirms
 * the comment popup. The host crops the image and owns the result. */
export interface ClipElementRequest extends ClipPageContext {
	comment: string;
	target: ClipElementTarget;
	boundingBox: ClipViewportRect;
	documentRect: ClipDocumentRect;
}

/** A region clip request: a marquee drag or a loupe-lens snap. */
export interface ClipRegionRequest extends ClipPageContext {
	rect: ClipViewportRect;
	documentRect: ClipDocumentRect;
	// Zoom the loupe was at for a lens snap; 1 for a marquee drag.
	zoom: number;
	// Topmost content element under the region's center, as a hint.
	coveredTag?: string;
	coveredSelector?: string;
}

/** Marker the host asks the guest to render for an existing clip. Markers
 * only render on the page whose pathname matches. */
export interface ClipMarker {
	id: string;
	number: number;
	grain: ClipGrain;
	comment?: string;
	pathname?: string;
	documentRect?: ClipDocumentRect;
}

/** A marker the *agent* places to point at something for the user —
 * rendered in a distinct style from the user's numbered clip markers. */
export interface AgentMarker {
	id: string;
	label?: string;
	// Either a selector resolved in the guest or an explicit rect.
	selector?: string;
	documentRect?: ClipDocumentRect;
}

export type InspectorGuestEvent =
	// Layer status for host chrome (toolbar pressed-state, menu labels).
	| {
			type: 'state';
			active: boolean;
			pinned: boolean;
			zoom: number;
			clipCount: number;
	  }
	// Browser keyboard shortcuts pressed while focus is in the guest page.
	| { type: 'browser-command'; command: 'back' | 'forward' | 'reload' }
	// The loupe wants a fresh viewport backdrop (see page-script docs).
	| { type: 'loupe-capture'; docX: number; docY: number; width: number; height: number }
	| { type: 'clip-element'; clip: ClipElementRequest }
	| { type: 'clip-region'; clip: ClipRegionRequest }
	// HUD "capture page" button.
	| { type: 'clip-page' }
	// Marker popup edits; the host applies them and re-syncs.
	| { type: 'clip-update'; id: string; comment: string }
	| { type: 'clip-remove'; id: string }
	// Context-menu "add selected text to chat".
	| ( { type: 'text-selection'; text: string } & ClipPageContext )
	// CLI submit toolbar: the user is done clipping.
	| { type: 'submit' };

export type InspectorHostCommand =
	// Modifier hold lifecycle forwarded from the host document.
	| { type: 'layer-hold-start' }
	| { type: 'layer-hold-end' }
	// Toolbar/menu toggle: pin or unpin the layer.
	| { type: 'layer-toggle' }
	| { type: 'layer-off' }
	// Reseed the remembered loupe zoom after a navigation reset the script.
	| { type: 'set-zoom'; zoom: number }
	// Refresh the loupe backdrop (e.g. after a color-scheme change).
	| { type: 'refresh-backdrop' }
	| { type: 'report-state' }
	// Full clip list; the guest re-renders markers from scratch.
	| { type: 'sync-clips'; clips: ClipMarker[] }
	// Agent-placed markers; replaces the previous set. Empty array clears.
	| { type: 'agent-markers'; markers: AgentMarker[] };

export interface InspectorFeatures {
	/** Element clips (hover highlight + comment popup). */
	elementClips: boolean;
	/** Marquee-drag region clips. */
	regionClips: boolean;
	/** HUD "capture page" button (requires a host that can capture). */
	pageClips: boolean;
	/** Zoom loupe (requires a host that pushes viewport backdrops). */
	loupe: boolean;
	/** Right-click menu: "Clip this element" / "Add selected text". */
	contextMenu: boolean;
	/** Forward ⌘R/⌘[/⌘] to the host as browser commands. */
	browserShortcuts: boolean;
	/** Standalone toolbar with a submit button (CLI browser mode, where
	 * there is no app chrome to finish from). */
	submitToolbar: boolean;
}

export interface InspectorConfig {
	features: InspectorFeatures;
	/** Loupe zoom to restore (a fresh document resets the script). */
	initialZoom?: number;
}

/** Full config as injected: the protocol constants ride along because the
 * serialized page function cannot reference module imports. */
export interface InspectorInjectedConfig extends InspectorConfig {
	bridgePrefix: string;
	commandEvent: string;
}

export function parseInspectorGuestEvent( consoleLine: string ): InspectorGuestEvent | null {
	if ( ! consoleLine.startsWith( INSPECTOR_BRIDGE_PREFIX ) ) {
		return null;
	}
	try {
		const parsed = JSON.parse( consoleLine.slice( INSPECTOR_BRIDGE_PREFIX.length ) );
		return parsed && typeof parsed.type === 'string' ? ( parsed as InspectorGuestEvent ) : null;
	} catch {
		return null;
	}
}

/** JS statement that dispatches a host command inside the guest. */
export function buildInspectorCommandScript( command: InspectorHostCommand ): string {
	return `window.dispatchEvent(new CustomEvent(${ JSON.stringify(
		INSPECTOR_COMMAND_EVENT
	) }, { detail: ${ JSON.stringify( command ) } }));`;
}
