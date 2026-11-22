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
 *                 pick | selection | annotation-tool | edit | anchor | escape | browser-command.
 *
 * Browser shortcuts (reload, back, forward) pressed inside the page are
 * forwarded too, so the host can handle them.
 */

import { PLUS_ICON } from '@studio/common/lib/plus-icon';
import { RENAME_ICON } from '@studio/common/lib/rename-icon';
import { createDrawingGeometry } from './drawing';
import {
	ANNOTATION_PEN_WIDTH,
	MAX_DRAWING_POINTS,
	MAX_DRAWING_STROKES,
	parseInspectorSelection,
	type InspectorSelection,
} from './selection';
import { getAnnotationToolShortcut, type AnnotationTool } from './shortcuts';
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
	host.style.cssText = 'all:initial;display:none!important;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
	host.hidden = true;
	document.documentElement.append(host);
	const root = host.attachShadow({ mode: 'open' });
	const cursorStyle = document.createElement('style');
	document.documentElement.append(cursorStyle);
	const style = document.createElement('style');
	style.textContent =
		'.highlight{position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid var(--accent);box-shadow:0 0 0 0.5px color-mix(in srgb,var(--on-accent) 20%,transparent);background:color-mix(in srgb,var(--accent) 8%,transparent)}' +
		'.highlight[data-region]{border:0;box-shadow:none}' +
		'.highlight[data-region]::after{content:"";position:absolute;inset:0;box-sizing:border-box;border:2px dashed var(--accent);filter:drop-shadow(0 0 0.5px color-mix(in srgb,var(--on-accent) 20%,transparent))}' +
		'button{position:fixed;transform:translate(-50%,-50%);border:0;border-radius:50%;width:36px;height:36px;padding:0;font:500 12px var(--marker-font-family,system-ui);font-variant-numeric:tabular-nums;background:var(--marker) center/contain no-repeat;color:var(--on-accent);cursor:pointer;pointer-events:auto}' +
		'button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}' +
		'.enter{animation:marker-in 600ms linear(0 0%,.0325 2.5%,.1163 5%,.2331 7.5%,.6385 15%,.7594 17.5%,.8639 20%,.9497 22.5%,1.0164 25%,1.0648 27.5%,1.0966 30%,1.1142 32.5%,1.1172 37.5%,1.0941 42.5%,1.0178 55%,.9887 65%,.9858 72.5%,1 100%) both,marker-fade-in var(--motion-duration-feedback,100ms) ease-out both}' +
		'button[data-feedback]{background-image:var(--marker-error);color:var(--on-error)}' +
		'.confirm{animation:marker-confirm 220ms ease-out both}' +
		'.leave{animation:marker-out 120ms ease-in both;pointer-events:none}' +
		'.plus,.number{position:absolute;inset:0;display:grid;place-items:center;transition:opacity 100ms var(--motion-ease-enter),transform var(--motion-duration-surface) var(--motion-ease-enter)}' +
		'.plus{opacity:0;transform:scale(.95)}' +
		'.number{opacity:1;transform:translateY(0)}' +
		'button[data-pending="true"] .plus{opacity:1;transform:scale(1)}' +
		'button[data-pending="true"] .number{opacity:0;transform:translateY(2px)}' +
		'@keyframes marker-in{from{transform:translate(-50%,-50%) scale(0)}to{transform:translate(-50%,-50%) scale(1)}}' +
		'@keyframes marker-confirm{from{transform:translate(-50%,-50%) scale(1)}25%{transform:translate(-50%,-50%) scale(.94)}65%{transform:translate(-50%,-50%) scale(1.06)}to{transform:translate(-50%,-50%) scale(1)}}' +
		'@keyframes marker-fade-in{from{opacity:0}to{opacity:1}}' +
		'@keyframes marker-out{from{transform:translate(-50%,-50%) scale(1);opacity:1}to{transform:translate(-50%,-50%) scale(0);opacity:0}}' +
		'@keyframes marker-fade-out{from{opacity:1}to{opacity:0}}' +
		'@media(prefers-reduced-motion:reduce){.enter{animation:marker-fade-in var(--motion-duration-feedback,100ms) ease-out both}.leave{animation:marker-fade-out 100ms ease-out both}.confirm{animation-name:marker-fade-in;animation-duration:1ms}.plus,.number,button[data-pending="true"] .plus,button[data-pending="true"] .number{transform:none;transition-property:opacity}}';
	style.textContent += ':host([data-capturing]) .highlight,:host([data-capturing]) .saved-drawings,:host([data-capturing]) button{visibility:hidden!important}';
	root.append(style);
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none';
	const savedDrawings = document.createElementNS(svg.namespaceURI, 'g');
	savedDrawings.setAttribute('class', 'saved-drawings');
	const draftDrawings = document.createElementNS(svg.namespaceURI, 'g');
	svg.append(savedDrawings, draftDrawings);
	root.append(svg);
	const highlight = document.createElement('div');
	highlight.className = 'highlight';
	highlight.hidden = true;
	root.append(highlight);
	const markers = document.createElement('div');
	root.append(markers);
	const markerNodes = new Map();
	let state = { active: false, notes: [], editingId: null };
	let exiting = false;
	let exitTimer = 0;
	let errorTimer = 0;
	let feedbackAnimation = null;
	let errorId = null;
	let replayEntry = false;
	function finishExit() {
		if (state.active) return;
		clearTimeout(exitTimer);
		exiting = false;
		render();
	}
	let hovered = null;
	let selected = null;
	let frame = 0;
	let gesture = null;
	let strokes = [];
	let penColor = '';
	let pendingSelection = null;
	let suppressClick = false;
	let savedNotes = null;
	let drawFrame = 0;
	let pointCount = 0;
	let holdTimer = 0;
	let originalStroke = null;
	let replacementId = null;
	const { pathData, recognizeEllipse } = (${ createDrawingGeometry.toString() })();
	const annotationToolShortcut = (${ getAnnotationToolShortcut.toString() });
	function pathFor(points, color, width) {
		const path = document.createElementNS(svg.namespaceURI, 'path');
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', color);
		path.setAttribute('stroke-width', String(width));
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');
		path.setAttribute('d', pathData(points));
		return path;
	}
	function repaintDrawing() {
		drawFrame = 0;
		if (gesture?.path) gesture.path.setAttribute('d', pathData(gesture.points));
	}
	function releaseGesture() {
		clearTimeout(holdTimer);
		holdTimer = 0;
		const current = gesture;
		gesture = null;
		if (current) {
			try { document.documentElement.releasePointerCapture(current.pointerId); } catch {}
		}
		return current;
	}
	function clearSelection() {
		const hadSelection = pendingSelection || strokes.length;
		if (gesture) suppressClick = true;
		releaseGesture();
		strokes = [];
		pointCount = 0;
		pendingSelection = null;
		originalStroke = null;
		replacementId = null;
		delete host.dataset.captureId;
		draftDrawings.replaceChildren();
		highlight.hidden = true;
		savedNotes = null;
		renderDrawings();
		if (hadSelection) emit({ type: 'selection', selection: null });
	}
	function areaBetween(a, b, padding = 0) {
		const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - padding));
		const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - padding));
		const right = Math.min(Math.floor(innerWidth), Math.ceil(Math.max(a.x, b.x) + padding));
		const bottom = Math.min(Math.floor(innerHeight), Math.ceil(Math.max(a.y, b.y) + padding));
		return { left, top, width: right - left, height: bottom - top };
	}
	function viewportPoint(event) {
		return { x: Math.round(Math.max(0, Math.min(innerWidth, event.clientX)) * 100) / 100, y: Math.round(Math.max(0, Math.min(innerHeight, event.clientY)) * 100) / 100 };
	}
	function selection(rect) {
		const result = {
			id: crypto.randomUUID(),
			target: {
				kind: strokes.length ? 'drawing' : 'region', url: location.href, path: location.pathname,
				viewport: { width: innerWidth, height: innerHeight },
				documentRect: { ...rect, left: rect.left + scrollX, top: rect.top + scrollY },
				point: { x: 1, y: 0 },
			},
			rect, scroll: { left: scrollX, top: scrollY },
		};
		if (strokes.length) result.drawing = { strokes, color: penColor, width: ${ ANNOTATION_PEN_WIDTH }, ...(originalStroke ? { originalStroke } : {}) };
		if (replacementId) result.replaces = replacementId;
		pendingSelection = result;
		host.dataset.captureId = result.id;
		return result;
	}
	function reportDrawing() {
		if (!strokes.length) { clearSelection(); return; }
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
		for (const stroke of strokes) for (const p of stroke) {
			left = Math.min(left, p.x - scrollX); top = Math.min(top, p.y - scrollY);
			right = Math.max(right, p.x - scrollX); bottom = Math.max(bottom, p.y - scrollY);
		}
		emit({ type: 'selection', selection: selection(areaBetween({ x: left, y: top }, { x: right, y: bottom }, 24)) });
	}
	function undoStroke() {
		if (state.busy || gesture) return;
		if (!strokes.length) {
			const note = state.notes.find((note) => note.id === state.editingId && onPage(note));
			if (!note?.drawing?.originalStroke) return;
			replacementId = note.id;
			penColor = note.drawing.color;
			strokes = [...note.drawing.strokes.slice(0, -1), note.drawing.originalStroke];
			pointCount = strokes.reduce((sum, stroke) => sum + stroke.length, 0);
			savedNotes = null;
			draftDrawings.replaceChildren(...strokes.map((stroke) => pathFor(stroke, penColor, ${ ANNOTATION_PEN_WIDTH })));
			render();
			reportDrawing();
			return;
		}
		if (originalStroke) {
			pointCount -= strokes[strokes.length - 1].length;
			strokes[strokes.length - 1] = originalStroke;
			originalStroke = null;
			draftDrawings.lastElementChild?.setAttribute('d', pathData(strokes[strokes.length - 1]));
			reportDrawing();
			return;
		}
		pointCount -= strokes.pop().length;
		draftDrawings.lastElementChild?.remove();
		reportDrawing();
	}
	function renderDrawings() {
		const translate = 'translate(' + -scrollX + ' ' + -scrollY + ')';
		savedDrawings.setAttribute('transform', translate);
		draftDrawings.setAttribute('transform', translate);
		if (savedNotes === state.notes) return;
		savedNotes = state.notes;
		savedDrawings.replaceChildren();
		for (const note of state.notes.filter(onPage)) {
			if (!note.drawing || note.id === replacementId) continue;
			for (const stroke of note.drawing.strokes) savedDrawings.append(pathFor(stroke, note.drawing.color, note.drawing.width));
		}
	}
	function emit(event) {
		try {
			console.log(PREFIX + JSON.stringify(event));
		} catch {}
	}
	function art(accent, onAccent) {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><filter id="s" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.14"/></filter></defs><circle cx="16" cy="16" r="12" fill="' + accent + '" filter="url(#s)"/><circle cx="16" cy="16" r="11.5" fill="none" stroke="' + onAccent + '" stroke-opacity="0.06" stroke-width="1"/></svg>';
		return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
	}
	function drawingCursor() {
		const path = '${ RENAME_ICON.path }';
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="${
			RENAME_ICON.viewBox
		}" stroke-linejoin="round"><path d="' + path + '" fill="white" stroke="white" stroke-width="28"/><path d="' + path + '" fill="black"/></svg>';
		return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 2 16, crosshair';
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
		if (note.kind || !note.selector) return null;
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
	function markerAnchor(point) {
		const width = Math.min(innerWidth, document.documentElement.clientWidth || innerWidth);
		const height = Math.min(innerHeight, document.documentElement.clientHeight || innerHeight);
		if (point.left < 0 || point.left > width || point.top < 0 || point.top > height) return null;
		const insetX = Math.min(24, width / 2);
		const insetY = Math.min(24, height / 2);
		return {
			left: Math.max(insetX, Math.min(point.left, width - insetX)),
			top: Math.max(insetY, Math.min(point.top, height - insetY)),
		};
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
		return markerAnchor({
			left: r.left + r.width * (note.point ? note.point.x : 1),
			top: r.top + r.height * (note.point ? note.point.y : 0),
		});
	}
	function render() {
		frame = 0;
		host.hidden = !state.active && !exiting;
		host.inert = !state.active;
		host.setAttribute('aria-hidden', String(!state.active));
		// The inline reset overrides the browser's [hidden] rule.
		host.style.setProperty('display', host.hidden ? 'none' : 'block', 'important');
		renderDrawings();
		const pageNotes = state.notes.filter(onPage);
		const ids = new Set(pageNotes.map((note) => note.id));
		for (const [id, marker] of markerNodes) {
			if (!ids.has(id)) {
				marker.remove();
				markerNodes.delete(id);
			}
			if (!state.active) {
				marker.classList.remove('enter', 'confirm');
				if (exiting) marker.classList.add('leave');
			}
		}
		if (!state.active) { highlight.hidden = true; return; }
		for (const note of pageNotes) {
			const p = anchor(note);
			let marker = markerNodes.get(note.id);
			if (!p) {
				if (marker) marker.hidden = true;
				continue;
			}
			if (!marker) {
				marker = document.createElement('button');
				marker.type = 'button';
				marker.className = 'enter';
				marker.innerHTML = '<span class="plus" aria-hidden="true"><svg width="12" height="12" viewBox="${
					PLUS_ICON.viewBox
				}" fill="currentColor"><path d="${
					PLUS_ICON.path
				}"/></svg></span><span class="number" aria-hidden="true"></span>';
				marker.addEventListener('animationend', (event) => {
					if (event.target !== marker) return;
					if (event.animationName === 'marker-out' || event.animationName === 'marker-fade-out') { finishExit(); return; }
					if (event.animationName === 'marker-fade-in' && !matchMedia('(prefers-reduced-motion:reduce)').matches) return;
					marker.classList.remove('enter', 'confirm');
				});
				markerNodes.set(note.id, marker);
				markers.append(marker);
			}
			const entering = replayEntry || marker.classList.contains('leave');
			if (entering) {
				marker.classList.remove('leave', 'confirm');
				marker.classList.add('enter');
			}
			if (!entering && marker.dataset.pending === 'true' && !note.pending) {
				marker.classList.remove('enter');
				marker.classList.add('confirm');
			}
			marker.hidden = false;
			if (marker.dataset.feedback !== (errorId === note.id ? 'error' : '')) {
				if (errorId === note.id) marker.dataset.feedback = 'error';
				else delete marker.dataset.feedback;
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
				if (state.busy) return;
				hovered = null;
				selected = resolve(note);
				emit({ type: 'edit', id: note.id, anchor: p });
			};
		}
		replayEntry = false;
		const note = state.notes.find((n) => n.id === state.editingId);
		if (note) emit({ type: 'anchor', id: note.id, anchor: onPage(note) ? anchor(note) : null });
		const el = hovered || selected;
		const region = note?.kind === 'region' && onPage(note) ? note.documentRect : null;
		highlight.toggleAttribute('data-region', Boolean(gesture?.kind === 'region' && gesture.dragged || pendingSelection?.target.kind === 'region' || region));
		let r = gesture?.rect || (pendingSelection?.target.kind === 'region' ? pendingSelection.rect : null);
		if (!r && state.tool !== 'draw') {
			if (region) r = { ...region, left: region.left - scrollX, top: region.top - scrollY };
			else if (note?.kind !== 'drawing' && el?.isConnected) r = el.getBoundingClientRect();
		}
		if (r) {
			const left = Math.max(0, r.left);
			const top = Math.max(0, r.top);
			const right = Math.min(innerWidth, r.left + r.width);
			const bottom = Math.min(innerHeight, r.top + r.height);
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
		return el instanceof Element && !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
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
			if (typeof e.detail.clearSelection === 'string') {
				if (!gesture && pendingSelection?.id === e.detail.clearSelection) { clearSelection(); schedule(); }
				return;
			}
			const wasActive = state.active;
			const previousAttempt = state.blockedNavigation;
			const previousEditingId = state.editingId;
			state = e.detail;
			if (previousEditingId !== state.editingId || gesture && gesture.kind !== (state.tool === 'draw' ? 'drawing' : 'region')) clearSelection();
			if (state.busy) { clearTimeout(holdTimer); holdTimer = 0; }
			if (!state.active && (strokes.length || pendingSelection || gesture)) clearSelection();
			if (!state.active || errorId !== state.editingId) { errorId = null; clearTimeout(errorTimer); feedbackAnimation?.cancel(); }
			if (state.active && typeof state.blockedNavigation === 'number' && previousAttempt !== undefined && state.blockedNavigation !== previousAttempt) {
				errorId = state.editingId;
				feedbackAnimation?.cancel();
				if (!matchMedia('(prefers-reduced-motion:reduce)').matches) {
					feedbackAnimation = markerNodes.get(errorId)?.animate?.([
						{ transform: 'translate(-50%,-50%) scale(1)', offset: 0 },
						{ transform: 'translate(-50%,-50%) scale(.94)', offset: .25 },
						{ transform: 'translate(-50%,-50%) scale(1.06)', offset: .65 },
						{ transform: 'translate(-50%,-50%) scale(1)', offset: 1 }
					], { duration: 220, easing: 'ease-out' });
				}
				clearTimeout(errorTimer);
				errorTimer = setTimeout(() => { errorId = null; render(); }, 900);
			}
			if (state.active !== wasActive) {
				clearTimeout(exitTimer);
				exiting = !state.active && Array.from(markerNodes.values()).some((marker) => !marker.hidden);
				replayEntry = state.active;
				if (exiting) exitTimer = setTimeout(finishExit, 200);
			}
			if (!state.active) hovered = null;
			host.style.setProperty('--accent', state.accent);
			host.style.setProperty('--on-accent', state.onAccent);
			host.style.setProperty('--marker-font-family', state.fontFamily || 'system-ui');
			host.style.setProperty('--marker', art(state.accent, state.onAccent));
			host.style.setProperty('--marker-error', art(state.destructive || state.accent, state.onDestructive || state.onAccent));
			host.style.setProperty('--on-error', state.onDestructive || state.onAccent);
			host.style.setProperty('--motion-duration-surface', state.motionDuration || '180ms');
			host.style.setProperty('--motion-ease-enter', state.motionEasing || 'cubic-bezier(.165,.84,.44,1)');
			const cursor = state.tool === 'draw' ? drawingCursor() : 'crosshair';
			cursorStyle.textContent = state.active ? '*{cursor:' + cursor + '!important' + (state.areaSelection || state.tool === 'draw' ? ';touch-action:none!important' : '') + '}' : '';
			const note = state.notes.find((n) => n.id === state.editingId);
			selected = note && onPage(note) ? resolve(note) : null;
			render();
		},
		{ signal: abort.signal }
	);
	document.addEventListener('pointerdown', (e) => {
		if (!state.active || (state.tool !== 'draw' && !state.areaSelection) || state.busy || isOwnUi(e) || e.button !== 0 || e.isPrimary === false || gesture) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		const start = viewportPoint(e);
		if (state.tool !== 'draw') clearSelection();
		suppressClick = false;
		gesture = { kind: state.tool === 'draw' ? 'drawing' : 'region', pointerId: e.pointerId, scrollX, scrollY, start, element: e.target, dragged: false };
		try { document.documentElement.setPointerCapture(e.pointerId); } catch {}
		if (gesture.kind === 'region') return;
		if (strokes.length >= ${ MAX_DRAWING_STROKES } || pointCount >= ${ MAX_DRAWING_POINTS }) { releaseGesture(); suppressClick = true; return; }
		if (pendingSelection) {
			pendingSelection = null;
			delete host.dataset.captureId;
			emit({ type: 'selection', selection: null });
		}
		if (!strokes.length) penColor = state.penColor || state.accent;
		if (originalStroke) { pointCount -= originalStroke.length; originalStroke = null; }
		gesture.points = [{ x: start.x + scrollX, y: start.y + scrollY }];
		strokes.push(gesture.points);
		pointCount++;
		gesture.path = pathFor(gesture.points, penColor, ${ ANNOTATION_PEN_WIDTH });
		draftDrawings.append(gesture.path);
		draftDrawings.setAttribute('transform', 'translate(' + -scrollX + ' ' + -scrollY + ')');
		hovered = selected = null;
		highlight.hidden = true;
	}, { capture: true, signal: abort.signal });
	function moveGesture(e) {
		if (!gesture || gesture.pointerId !== e.pointerId) return;
		if (gesture.kind === 'region') {
			const point = viewportPoint(e);
			gesture.dragged ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) >= 6;
			if (gesture.dragged) {
				gesture.rect = areaBetween(gesture.start, point);
				hovered = selected = null;
				schedule();
			}
			return;
		}
		const coalesced = e.type === 'pointermove' ? e.getCoalescedEvents?.() : null;
		for (const sample of coalesced?.length ? [...coalesced, e] : [e]) {
			const point = viewportPoint(sample);
			const next = { x: point.x + gesture.scrollX, y: point.y + gesture.scrollY };
			if (gesture.originalPoints) {
				if (Math.hypot(next.x - gesture.holdPoint.x, next.y - gesture.holdPoint.y) <= 3) continue;
				pointCount -= gesture.points.length;
				gesture.points = gesture.originalPoints;
				gesture.originalPoints = null;
				originalStroke = null;
				strokes[strokes.length - 1] = gesture.points;
			}
			const last = gesture.points[gesture.points.length - 1];
			if (pointCount >= ${ MAX_DRAWING_POINTS } || Math.hypot(next.x - last.x, next.y - last.y) < 1.5) continue;
			gesture.points.push(next); pointCount++;
			if (!gesture.holdPoint || Math.hypot(next.x - gesture.holdPoint.x, next.y - gesture.holdPoint.y) > 3) {
				clearTimeout(holdTimer);
				gesture.holdPoint = next;
				const current = gesture;
				holdTimer = setTimeout(() => {
					if (gesture !== current || !state.active || state.tool !== 'draw' || state.busy) return;
					const shape = recognizeEllipse(current.points);
					if (!shape || pointCount + shape.length > ${ MAX_DRAWING_POINTS } || shape.some((p) => p.x < scrollX || p.y < scrollY || p.x > scrollX + innerWidth || p.y > scrollY + innerHeight)) return;
					current.originalPoints = originalStroke = current.points;
					current.points = shape;
					strokes[strokes.length - 1] = shape;
					pointCount += shape.length;
					repaintDrawing();
				}, 600);
			}
			if (!drawFrame) drawFrame = requestAnimationFrame(repaintDrawing);
		}
	}
	document.addEventListener('pointerup', (e) => {
		if (!gesture || gesture.pointerId !== e.pointerId) return;
		e.preventDefault(); e.stopImmediatePropagation();
		moveGesture(e);
		repaintDrawing();
		const done = releaseGesture();
		suppressClick = true;
		if (done.kind === 'drawing') reportDrawing();
		else if (done.dragged) {
			if (done.rect.width >= 2 && done.rect.height >= 2) emit({ type: 'selection', selection: selection(done.rect) });
		} else if (done.element instanceof Element && done.element.isConnected) {
			selected = hovered = done.element;
			emit({ type: 'pick', target: metadata(selected, e), anchor: markerAnchor({ left: e.clientX, top: e.clientY }) });
		}
		schedule();
	}, { capture: true, signal: abort.signal });
	function cancelGesture(e) {
		if (!gesture || (e.pointerId !== undefined && gesture.pointerId !== e.pointerId)) return;
		suppressClick = true;
		const current = releaseGesture();
		if (current?.kind === 'drawing') { pointCount -= strokes.pop().length + (originalStroke?.length || 0); originalStroke = null; current.path.remove(); reportDrawing(); }
		schedule();
	}
	document.addEventListener('pointercancel', cancelGesture, { capture: true, signal: abort.signal });
	document.addEventListener('lostpointercapture', (e) => {
		if (!gesture || gesture.pointerId !== e.pointerId || e.target !== document.documentElement) return;
		// Focusing an Electron guest can release capture while the pointer is still down.
		try {
			if (!document.documentElement.hasPointerCapture(e.pointerId)) document.documentElement.setPointerCapture(e.pointerId);
		} catch {}
	}, { capture: true, signal: abort.signal });
	window.addEventListener('blur', cancelGesture, { signal: abort.signal });
	const stopScroll = (e) => {
		if (state.active && (strokes.length || gesture || pendingSelection)) e.preventDefault();
	};
	document.addEventListener('wheel', stopScroll, { capture: true, passive: false, signal: abort.signal });
	document.addEventListener('touchmove', stopScroll, { capture: true, passive: false, signal: abort.signal });
	document.addEventListener(
		'pointermove',
		(e) => {
			if (!state.active) return;
			if (gesture) { moveGesture(e); return; }
			hovered = state.tool === 'draw' || pendingSelection || isOwnUi(e) ? null : e.target;
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
			if (suppressClick) { suppressClick = false; return; }
			if (state.busy || state.tool === 'draw') return;
			if (!(e.target instanceof Element)) return;
			selected = e.target;
			hovered = selected;
			emit({ type: 'pick', target: metadata(selected, e), anchor: markerAnchor({ left: e.clientX, top: e.clientY }) });
		},
		{ capture: true, signal: abort.signal }
	);
	document.addEventListener(
		'keydown',
		(e) => {
			const tool = annotationToolShortcut(e);
			const target = e.composedPath()[0];
			if (tool && state.active && (state.tool === 'select' || state.tool === 'draw') && !state.busy && !gesture && !isTextEntry(target) && !(target instanceof Element && target.closest('[role="menu"], [role="listbox"], [role="dialog"], dialog[open]'))) {
				e.preventDefault(); e.stopPropagation();
				emit({ type: 'annotation-tool', tool });
				return;
			}
			if (state.active && e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				if (strokes.length || pendingSelection || gesture) { if (!state.busy) { clearSelection(); schedule(); } return; }
				emit({ type: 'escape' });
				return;
			}
			if (state.active && !isTextEntry(target) && (strokes.length || state.notes.some((note) => note.id === state.editingId && note.drawing?.originalStroke && onPage(note))) && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
				e.preventDefault(); e.stopPropagation(); undoStroke(); return;
			}
			if (state.active && (strokes.length || gesture || pendingSelection) && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
				e.preventDefault(); return;
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
	const geometryChanged = () => {
		if (gesture || strokes.length || pendingSelection) clearSelection();
		schedule();
	};
	document.addEventListener('scroll', geometryChanged, { capture: true, passive: true, signal: abort.signal });
	window.addEventListener('resize', geometryChanged, { signal: abort.signal });
	const resize = new ResizeObserver(schedule);
	resize.observe(document.documentElement);
	const mutation = new MutationObserver(schedule);
	mutation.observe(document.body || document.documentElement, { subtree: true, childList: true, attributes: true });
	window[KEY] = () => {
		abort.abort();
		feedbackAnimation?.cancel();
		clearTimeout(exitTimer);
		clearTimeout(errorTimer);
		resize.disconnect();
		mutation.disconnect();
		cancelAnimationFrame(frame);
		cancelAnimationFrame(drawFrame);
		releaseGesture();
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
	| { type: 'selection'; selection: InspectorSelection | null }
	| { type: 'annotation-tool'; tool: AnnotationTool }
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
		case 'annotation-tool':
			return data.tool === 'select' || data.tool === 'draw'
				? { type: 'annotation-tool', tool: data.tool }
				: null;
		case 'selection': {
			if ( data.selection === null ) return { type: 'selection', selection: null };
			const selection = parseInspectorSelection( data.selection );
			return selection ? { type: data.type, selection } : null;
		}
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
