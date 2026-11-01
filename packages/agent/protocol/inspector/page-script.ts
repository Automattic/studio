/**
 * Annotation inspector injected into a site page: the Desktop preview's
 * `<webview>` and the CLI's annotation browser both evaluate it after each load.
 *
 * The page only handles geometry: hover highlight, picking an element, and the
 * numbered markers. Note text and attachments stay with the host, which draws
 * the note editor. Elements with a `data-studio-inspector` attribute are the
 * host's own UI, so the inspector ignores pointer events inside them.
 *
 *   host -> page: `INSPECTOR_COMMAND_EVENT` on `window`, with the annotation
 *                 state as its detail (active, notes, editingId, colors).
 *   page -> host: `console.log( INSPECTOR_BRIDGE_PREFIX + JSON )`:
 *                 pick | edit | anchor | escape | browser-command.
 *
 * Browser shortcuts (reload, back, forward) pressed inside the page are
 * forwarded too, so the host can handle them.
 */

import { PLUS_ICON } from '@studio/common/lib/plus-icon';
import type { VisualAnnotationTarget } from '@studio/agent/protocol/visual-annotations';

export const INSPECTOR_BRIDGE_PREFIX = '__studio-inspector__:';
export const INSPECTOR_COMMAND_EVENT = '__studio-inspector-command';

export const INSPECTOR_PAGE_SCRIPT = String.raw`
(() => {
	const KEY = '__studioInspectorDispose';
	if (typeof window[KEY] === 'function') window[KEY]();
	const abort = new AbortController();
	const PREFIX = '${ INSPECTOR_BRIDGE_PREFIX }';
	const host = document.createElement('div');
	host.id = '__studio-inspector-host';
	host.dataset.studioInspector = '';
	host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
	host.hidden = true;
	document.documentElement.append(host);
	const root = host.attachShadow({ mode: 'open' });
	const cursorStyle = document.createElement('style');
	document.documentElement.append(cursorStyle);
	const style = document.createElement('style');
	style.textContent =
		'.highlight{position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}' +
		'button{position:fixed;transform:translate(-50%,-50%);border:0;border-radius:50%;width:32px;height:32px;padding:0;font:500 12px var(--marker-font-family,system-ui);font-variant-numeric:tabular-nums;background:var(--marker) center/contain no-repeat;color:var(--on-accent);cursor:pointer;pointer-events:auto}' +
		'button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}' +
		'.enter{animation:marker-in 250ms cubic-bezier(.22,1,.36,1) both}' +
		'.confirm{animation:marker-confirm 220ms ease-out both}' +
		'.plus,.number{position:absolute;inset:0;display:grid;place-items:center;transition:opacity 100ms var(--motion-ease-enter),transform var(--motion-duration-surface) var(--motion-ease-enter)}' +
		'.plus{opacity:0;transform:scale(.95)}' +
		'.number{opacity:1;transform:translateY(0)}' +
		'button[data-pending="true"] .plus{opacity:1;transform:scale(1)}' +
		'button[data-pending="true"] .number{opacity:0;transform:translateY(2px)}' +
		'@keyframes marker-in{from{opacity:0;transform:translate(-50%,-50%) scale(.3)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}' +
		'@keyframes marker-confirm{from{transform:translate(-50%,-50%) scale(1)}25%{transform:translate(-50%,-50%) scale(.94)}65%{transform:translate(-50%,-50%) scale(1.06)}to{transform:translate(-50%,-50%) scale(1)}}' +
		'@keyframes marker-fade-in{from{opacity:0}to{opacity:1}}' +
		'@media(prefers-reduced-motion:reduce){.enter{animation-name:marker-fade-in;animation-duration:var(--motion-duration-surface)}.confirm{animation-name:marker-fade-in;animation-duration:1ms}.plus,.number,button[data-pending="true"] .plus,button[data-pending="true"] .number{transform:none;transition-property:opacity}}';
	root.append(style);
	const highlight = document.createElement('div');
	highlight.className = 'highlight';
	highlight.hidden = true;
	root.append(highlight);
	const markers = document.createElement('div');
	root.append(markers);
	const markerNodes = new Map();
	let state = { active: false, notes: [], editingId: null };
	let hovered = null;
	let selected = null;
	let frame = 0;

	function emit(event) {
		try {
			console.log(PREFIX + JSON.stringify(event));
		} catch {}
	}
	function art(accent, onAccent) {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><filter id="s" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.14"/></filter></defs><circle cx="16" cy="16" r="12" fill="' + accent + '" filter="url(#s)"/><circle cx="16" cy="16" r="11.5" fill="none" stroke="' + onAccent + '" stroke-opacity="0.12" stroke-width="1"/></svg>';
		return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
	}
	function selector(el) {
		if (el.id) return '#' + CSS.escape(el.id);
		const parts = [];
		let node = el;
		while (node && node !== document.documentElement) {
			let part = node.tagName.toLowerCase();
			part += Array.from(node.classList)
				.filter((c) => !c.startsWith('__studio-'))
				.slice(0, 3)
				.map((c) => '.' + CSS.escape(c))
				.join('');
			const parent = node.parentElement;
			if (parent) {
				const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
				if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
			}
			parts.unshift(part);
			node = parent;
			if (parts.length >= 6) break;
		}
		return parts.join(' > ');
	}
	function metadata(el, event) {
		const cs = getComputedStyle(el);
		const computedStyles = {};
		for (const key of ['color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'padding', 'margin', 'border', 'display', 'width', 'height'])
			computedStyles[key] = cs.getPropertyValue(key);
		const r = el.getBoundingClientRect();
		return {
			selector: selector(el),
			tag: el.tagName.toLowerCase(),
			classes: Array.from(el.classList).slice(0, 10),
			nearbyText: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
			url: location.href,
			path: location.pathname,
			viewport: { width: innerWidth, height: innerHeight },
			documentRect: { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height },
			point: {
				x: Math.max(0, Math.min(1, (event.clientX - r.left) / Math.max(1, r.width))),
				y: Math.max(0, Math.min(1, (event.clientY - r.top) / Math.max(1, r.height))),
			},
			computedStyles,
		};
	}
	function resolve(note) {
		try {
			return document.querySelector(note.selector);
		} catch {
			return null;
		}
	}
	function onPage(note) {
		try {
			const u = new URL(note.url);
			return u.origin === location.origin && u.pathname === location.pathname;
		} catch {
			return false;
		}
	}
	function anchor(note) {
		const el = resolve(note);
		const r = el
			? el.getBoundingClientRect()
			: {
					left: note.documentRect.left - scrollX,
					top: note.documentRect.top - scrollY,
					width: note.documentRect.width,
					height: note.documentRect.height,
			  };
		return {
			left: r.left + r.width * (note.point ? note.point.x : 1),
			top: r.top + r.height * (note.point ? note.point.y : 0),
		};
	}
	function render() {
		frame = 0;
		host.hidden = !state.active;
		const pageNotes = state.notes.filter(onPage);
		const ids = new Set(pageNotes.map((note) => note.id));
		for (const [id, marker] of markerNodes) {
			if (!ids.has(id)) {
				marker.remove();
				markerNodes.delete(id);
			}
			if (!state.active) marker.classList.remove('enter', 'confirm');
		}
		if (!state.active) return;
		for (const note of pageNotes) {
			const p = anchor(note);
			let marker = markerNodes.get(note.id);
			if (!marker) {
				marker = document.createElement('button');
				marker.type = 'button';
				marker.className = 'enter';
				marker.innerHTML = '<span class="plus" aria-hidden="true"><svg width="12" height="12" viewBox="${ PLUS_ICON.viewBox }" fill="none"><path d="${ PLUS_ICON.path }" stroke-width="${ PLUS_ICON.strokeWidth }" stroke-linecap="${ PLUS_ICON.strokeLinecap }" stroke="currentColor"/></svg></span><span class="number" aria-hidden="true"></span>';
				marker.addEventListener('animationend', (event) => {
					if (event.target === marker) marker.classList.remove('enter', 'confirm');
				});
				markerNodes.set(note.id, marker);
				markers.append(marker);
			}
			if (marker.dataset.pending === 'true' && !note.pending) {
				marker.classList.remove('enter');
				marker.classList.add('confirm');
			}
			marker.dataset.pending = String(Boolean(note.pending));
			const number = marker.querySelector('.number');
			if (number.textContent !== String(note.number)) number.textContent = String(note.number);
			marker.setAttribute('aria-label', note.pending ? state.pendingAnnotationLabel : state.annotationLabel + ' ' + note.number);
			marker.style.left = p.left + 'px';
			marker.style.top = p.top + 'px';
			marker.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				hovered = null;
				selected = resolve(note);
				emit({ type: 'edit', id: note.id, anchor: p });
			};
		}
		const note = state.notes.find((n) => n.id === state.editingId);
		if (note) emit({ type: 'anchor', id: note.id, anchor: onPage(note) ? anchor(note) : null });
		const el = hovered || selected;
		if (el && el.isConnected) {
			const r = el.getBoundingClientRect();
			const left = Math.max(0, r.left);
			const top = Math.max(0, r.top);
			const right = Math.min(innerWidth, r.right);
			const bottom = Math.min(innerHeight, r.bottom);
			Object.assign(highlight.style, { left: left + 'px', top: top + 'px', width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px' });
			highlight.hidden = right <= left || bottom <= top;
		} else highlight.hidden = true;
	}
	function isOwnUi(e) {
		return e.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-studio-inspector'));
	}
	function schedule() {
		if (!frame) frame = requestAnimationFrame(render);
	}
	function isTextEntry(el) {
		return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
	}
	function shortcut(e) {
		if (e.defaultPrevented || e.repeat) return null;
		const apple = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			const chord = apple ? e.metaKey && !e.ctrlKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey;
			if (!chord || e.shiftKey || isTextEntry(e.composedPath()[0])) return null;
			return e.key === 'ArrowLeft' ? 'back' : 'forward';
		}
		if (e.altKey || !(apple ? e.metaKey : e.ctrlKey)) return null;
		const key = e.key.toLowerCase();
		if (key === 'r') return 'reload';
		if (e.shiftKey) return null;
		return key === '[' ? 'back' : key === ']' ? 'forward' : null;
	}

	window.addEventListener(
		'${ INSPECTOR_COMMAND_EVENT }',
		(e) => {
			if (!e.detail) return;
			state = e.detail;
			if (!state.active) hovered = null;
			host.style.setProperty('--accent', state.accent);
			host.style.setProperty('--on-accent', state.onMarkerAccent || state.onAccent);
			host.style.setProperty('--marker-font-family', state.fontFamily || 'system-ui');
			host.style.setProperty('--marker', art(state.markerAccent || state.accent, state.onMarkerAccent || state.onAccent));
			host.style.setProperty('--motion-duration-surface', state.motionDuration || '180ms');
			host.style.setProperty('--motion-ease-enter', state.motionEasing || 'cubic-bezier(.165,.84,.44,1)');
			cursorStyle.textContent = state.active ? '*{cursor:crosshair!important}' : '';
			const note = state.notes.find((n) => n.id === state.editingId);
			selected = note && onPage(note) ? resolve(note) : null;
			render();
		},
		{ signal: abort.signal }
	);
	document.addEventListener(
		'pointermove',
		(e) => {
			if (!state.active) return;
			hovered = isOwnUi(e) ? null : e.target;
			schedule();
		},
		{ capture: true, signal: abort.signal }
	);
	document.addEventListener(
		'pointerout',
		(e) => {
			if (!state.active || e.relatedTarget) return;
			hovered = null;
			schedule();
		},
		{ capture: true, signal: abort.signal }
	);
	document.addEventListener(
		'click',
		(e) => {
			if (!state.active || isOwnUi(e)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if (!(e.target instanceof Element)) return;
			selected = e.target;
			hovered = selected;
			emit({ type: 'pick', target: metadata(selected, e), anchor: { left: e.clientX, top: e.clientY } });
		},
		{ capture: true, signal: abort.signal }
	);
	document.addEventListener(
		'keydown',
		(e) => {
			if (state.active && e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				emit({ type: 'escape' });
				return;
			}
			const command = shortcut(e);
			if (command) {
				e.preventDefault();
				e.stopPropagation();
				emit({ type: 'browser-command', command });
			}
		},
		{ capture: true, signal: abort.signal }
	);
	document.addEventListener('scroll', schedule, { capture: true, passive: true, signal: abort.signal });
	window.addEventListener('resize', schedule, { signal: abort.signal });
	const resize = new ResizeObserver(schedule);
	resize.observe(document.documentElement);
	const mutation = new MutationObserver(schedule);
	mutation.observe(document.body || document.documentElement, { subtree: true, childList: true, attributes: true });
	window[KEY] = () => {
		abort.abort();
		resize.disconnect();
		mutation.disconnect();
		cancelAnimationFrame(frame);
		host.remove();
		cursorStyle.remove();
		delete window[KEY];
	};
})();
`;

export type BrowserShortcutCommand = 'back' | 'forward' | 'reload';

interface Point {
	left: number;
	top: number;
}

export type InspectorEvent =
	| { type: 'pick'; target: VisualAnnotationTarget; anchor: Point }
	| { type: 'edit'; id: string; anchor: Point }
	| { type: 'anchor'; id: string; anchor: Point | null }
	| { type: 'escape' }
	| { type: 'browser-command'; command: BrowserShortcutCommand };

const MAX_MESSAGE_LENGTH = 100_000;

type Data = Record< string, unknown >;
const isData = ( value: unknown ): value is Data => typeof value === 'object' && value !== null;
const isNumber = ( value: unknown ): value is number =>
	typeof value === 'number' && Number.isFinite( value );
const text = ( value: unknown, max: number ) =>
	typeof value === 'string' ? value.slice( 0, max ) : '';

function point( value: unknown, offset: Point ): Point | null {
	return isData( value ) && isNumber( value.left ) && isNumber( value.top )
		? { left: value.left + offset.left, top: value.top + offset.top }
		: null;
}

function box( value: unknown ) {
	return isData( value ) && [ value.left, value.top, value.width, value.height ].every( isNumber )
		? {
				left: value.left as number,
				top: value.top as number,
				width: value.width as number,
				height: value.height as number,
		  }
		: undefined;
}

// The page can log anything, and a picked target ends up in the agent's
// prompt, so only well-formed fields of bounded size get through.
function target( value: unknown ): VisualAnnotationTarget | null {
	if ( ! isData( value ) || typeof value.selector !== 'string' || typeof value.tag !== 'string' ) {
		return null;
	}
	const viewport = isData( value.viewport ) ? value.viewport : {};
	const where = isData( value.point ) ? value.point : {};
	const styles = isData( value.computedStyles ) ? value.computedStyles : {};
	return {
		selector: text( value.selector, 10_000 ),
		tag: text( value.tag, 100 ),
		classes: Array.isArray( value.classes )
			? value.classes.slice( 0, 10 ).map( ( item ) => text( item, 1000 ) )
			: [],
		nearbyText: text( value.nearbyText, 1000 ),
		url: text( value.url, 10_000 ),
		path: text( value.path, 10_000 ),
		viewport:
			isNumber( viewport.width ) && isNumber( viewport.height )
				? { width: viewport.width, height: viewport.height }
				: undefined,
		documentRect: box( value.documentRect ),
		point:
			isNumber( where.x ) && isNumber( where.y )
				? { x: Math.min( 1, Math.max( 0, where.x ) ), y: Math.min( 1, Math.max( 0, where.y ) ) }
				: undefined,
		computedStyles: Object.fromEntries(
			Object.entries( styles )
				.slice( 0, 20 )
				.map( ( [ key, style ] ) => [ text( key, 100 ), text( style, 1000 ) ] )
		),
	};
}

// `offset` moves anchors from the page's viewport into the host's coordinates.
export function parseInspectorMessage(
	message: unknown,
	offset: Point = { left: 0, top: 0 }
): InspectorEvent | null {
	if (
		typeof message !== 'string' ||
		! message.startsWith( INSPECTOR_BRIDGE_PREFIX ) ||
		message.length > MAX_MESSAGE_LENGTH
	) {
		return null;
	}
	let data: unknown;
	try {
		data = JSON.parse( message.slice( INSPECTOR_BRIDGE_PREFIX.length ) );
	} catch {
		return null;
	}
	if ( ! isData( data ) ) return null;
	const anchor = point( data.anchor, offset );
	switch ( data.type ) {
		case 'pick': {
			const picked = target( data.target );
			return picked && anchor ? { type: 'pick', target: picked, anchor } : null;
		}
		case 'edit':
			return typeof data.id === 'string' && anchor ? { type: 'edit', id: data.id, anchor } : null;
		case 'anchor':
			return typeof data.id === 'string' ? { type: 'anchor', id: data.id, anchor } : null;
		case 'escape':
			return { type: 'escape' };
		case 'browser-command':
			return data.command === 'back' || data.command === 'forward' || data.command === 'reload'
				? { type: 'browser-command', command: data.command }
				: null;
		default:
			return null;
	}
}
