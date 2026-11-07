import type { VisualAnnotationTarget } from '@studio/agent/protocol/visual-annotations';

export interface InspectorTextEdit {
	id: string;
	target: VisualAnnotationTarget;
	originalText: string;
	text: string;
}

export interface PreviewTextEdit extends InspectorTextEdit {
	pending: boolean;
}

export const MAX_TEXT_EDIT_LENGTH = 4000;

// Evaluated in the inspector's scope so text editing shares its bridge and geometry.
export const INSPECTOR_TEXT_EDIT_SCRIPT = String.raw`
const textEditor = (() => {
	let editing = null;
	let lastUpdate = '';
	const replacements = new Map();
	const textStyle = document.createElement('style');
	textStyle.textContent =
		'[data-studio-text-editing]{outline:none!important;cursor:text!important}' +
		'.__studio-text-pending{background-image:linear-gradient(110deg,currentColor 35%,oklch(from currentColor l c h / .35) 50%,currentColor 65%)!important;background-size:250% 100%!important;background-repeat:no-repeat!important;background-clip:text!important;-webkit-text-fill-color:transparent!important;animation:__studio-text-shimmer 2s linear infinite!important}' +
		'@keyframes __studio-text-shimmer{from{background-position:100% 0}to{background-position:0 0}}' +
		'@media(prefers-reduced-motion:reduce){.__studio-text-pending{animation:none!important;background-image:none!important;-webkit-text-fill-color:currentColor!important}}';
	document.documentElement.append(textStyle);
	const read = (el) => (el.innerText ?? el.textContent ?? '').replace(/\r\n/g, '\n');
	function candidate(node) {
		if (!(node instanceof HTMLElement) || node.closest('input,textarea,select,[contenteditable],svg,canvas,iframe,[hidden],[inert],.__studio-text-pending')) return null;
		const el = node.closest('h1,h2,h3,h4,h5,h6,p,figcaption,blockquote,li') || node.closest('a,button,label,span,strong,em,b,i,small');
		if (!el || !read(el).trim() || read(el).length > ${ MAX_TEXT_EDIT_LENGTH } || el.querySelector('input,textarea,select,h1,h2,h3,h4,h5,h6,p,ul,ol,table,img,svg')) return null;
		return el;
	}
	function snapshot() {
		return editing && { id: editing.id, target: editing.target, originalText: editing.originalText, text: read(editing.el) };
	}
	function report() {
		if (!editing) return;
		if (!editing.el.isConnected) { cancel(); return; }
		const range = document.createRange();
		range.selectNodeContents(editing.el);
		const rects = range.getClientRects?.();
		const r = rects?.length ? rects[rects.length - 1] : editing.el.getBoundingClientRect();
		const event = { type: 'text-edit', edit: snapshot(), anchor: r.bottom < 0 || r.top > innerHeight ? null : { left: r.right, top: r.top + r.height / 2 } };
		const serialized = JSON.stringify(event);
		if (lastUpdate !== serialized) { lastUpdate = serialized; emit(event); }
	}
	function finish() {
		if (!editing) return;
		const el = editing.el;
		el.removeAttribute('contenteditable');
		el.removeAttribute('data-studio-text-editing');
		el.blur();
		editing = null;
		hovered = selected = null;
		lastUpdate = '';
		emit({ type: 'text-edit', edit: null, anchor: null });
		schedule();
	}
	function cancel() {
		if (editing?.el.isConnected) editing.el.innerHTML = editing.html;
		finish();
	}
	function begin(node, event) {
		if (editing) return editing.el.contains(node);
		const el = candidate(node);
		if (!el) return false;
		editing = { id: crypto.randomUUID(), el, html: el.innerHTML, originalText: read(el), target: metadata(el, event) };
		el.setAttribute('contenteditable', 'plaintext-only');
		el.setAttribute('data-studio-text-editing', '');
		el.focus({ preventScroll: true });
		report();
		return true;
	}
	function update() {
		if (editing && (!state.active || state.tool !== 'text')) cancel();
		const edits = (state.textEdits || []).filter((edit) => onPage(edit.target));
		const ids = new Set(edits.map((edit) => edit.id));
		for (const [id, previous] of replacements) {
			if (!ids.has(id)) { previous.el.classList.remove('__studio-text-pending'); replacements.delete(id); }
		}
		for (const edit of edits) {
			let el;
			try { el = document.querySelector(edit.target.selector); } catch { continue; }
			if (!el || el === editing?.el) continue;
			let previous = replacements.get(edit.id);
			if (previous?.el !== el) {
				previous?.el.classList.remove('__studio-text-pending');
				const value = read(el);
				if (value !== edit.text && (!edit.pending || value !== edit.originalText)) continue;
				previous = { el, html: el.innerHTML };
				replacements.set(edit.id, previous);
			}
			if (edit.pending && read(el) === edit.originalText && read(el) !== edit.text) el.textContent = edit.text;
			if (el.classList.contains('__studio-text-pending') !== edit.pending) el.classList.toggle('__studio-text-pending', edit.pending);
		}
		report();
	}
	document.addEventListener('input', (event) => {
		if (!editing?.el.contains(event.target)) return;
		event.stopImmediatePropagation();
		if (read(editing.el).length > ${ MAX_TEXT_EDIT_LENGTH }) editing.el.textContent = read(editing.el).slice(0, ${ MAX_TEXT_EDIT_LENGTH });
		report();
	}, { capture: true, signal: abort.signal });
	document.addEventListener('beforeinput', (event) => {
		if (editing?.el.contains(event.target)) event.stopImmediatePropagation();
	}, { capture: true, signal: abort.signal });
	document.addEventListener('submit', (event) => {
		if (!editing) return;
		event.preventDefault(); event.stopImmediatePropagation();
	}, { capture: true, signal: abort.signal });
	return {
		begin, cancel, update,
		get active() { return !!editing; },
		contains: (node) => !!editing?.el.contains(node),
		hover: (node) => editing?.el || candidate(node),
		commit: finish,
		keydown: (event) => {
			if (!editing) return false;
			if (event.key === 'Escape') { cancel(); return true; }
			return false;
		},
		dispose: () => {
			cancel();
			for (const previous of replacements.values()) previous.el.classList.remove('__studio-text-pending');
			textStyle.remove();
		},
	};
})();
`;
