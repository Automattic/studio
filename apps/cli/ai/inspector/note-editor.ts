/**
 * The annotation browser's note editor and Cancel / Send bar, layered over the
 * shared inspector (`@studio/common/ai/inspector/page-script`) in its own Shadow
 * DOM root. Vanilla DOM, so it works on any page whatever its CSP or theme CSS.
 *
 * The notes live in the CLI, which draws this editor from them:
 *
 *   CLI -> page: `NOTE_EDITOR_EVENT` on `window`. A detail with `editing` loads
 *                that note into the editor (null closes it); `anchor` places it.
 *   page -> CLI: `window[ NOTE_EDITOR_BINDING ]( action )`:
 *                change | save | delete | send | cancel.
 */

export const NOTE_EDITOR_EVENT = '__studio-note-editor';
export const NOTE_EDITOR_BINDING = '__studioNoteEditor';

const STYLE = `
	:host { --surface: #fff; --text: #1e1e1e; --weak: #707070; --stroke: #dbdbdb; --hover: #ededed; --brand: #3858e9; --brand-active: #2145e6; --on-brand: #eff0f2; --muted: #e0e0e0; }
	@media (prefers-color-scheme: dark) {
		:host { --surface: #2f2f2f; --text: #f0f0f0; --weak: #a8a8a8; --stroke: #4a4a4a; --hover: #3c3c3c; --brand: #5b7bff; --brand-active: #4a6af0; --on-brand: #fff; --muted: #4a4a4a; }
	}
	* { box-sizing: border-box; cursor: default; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
	[hidden] { display: none !important; }
	button { display: inline-flex; flex: none; align-items: center; justify-content: center; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
	svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.editor { position: fixed; display: flex; flex-direction: column; gap: 4px; width: 320px; max-width: calc(100% - 16px); max-height: calc(100% - 80px); padding: 4px; overflow-y: auto; border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); border-radius: 24px; background: var(--surface); color: var(--text); box-shadow: 0 4px 16px rgb(0 0 0 / 12%); pointer-events: auto; }
	.images { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; padding: 8px 8px 4px; list-style: none; }
	.images li { position: relative; width: 48px; height: 48px; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--stroke); }
	.images img { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }
	.images button { position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; border: 1px solid var(--stroke); border-radius: 50%; background: var(--surface); }
	.images svg { width: 12px; height: 12px; }
	textarea { display: block; width: 100%; min-height: 36px; max-height: calc(6lh + 16px); padding: 8px 10px; border: 0; outline: none; background: transparent; color: inherit; font-size: 14px; line-height: 20px; resize: none; field-sizing: content; cursor: text; }
	textarea::placeholder { color: var(--weak); }
	.toolbar { display: flex; align-items: center; gap: 4px; padding: 0 4px 4px; }
	.tool { width: 32px; height: 32px; border-radius: 999px; }
	.tool:hover { background: var(--hover); }
	.save { width: 36px; height: 36px; margin-inline-start: auto; border-radius: 999px; background: var(--brand); color: var(--on-brand); }
	.save svg { width: 20px; height: 20px; stroke-width: 1.5; }
	.save:hover:not(:disabled) { background: var(--brand-active); }
	.save:disabled { background: var(--muted); color: var(--text); opacity: 0.5; cursor: default; }
	.bar { position: fixed; bottom: 16px; left: 50%; display: flex; align-items: center; gap: 4px; padding: 6px; border-radius: 13px; background: var(--surface); color: var(--text); box-shadow: 0 0 0 1px color-mix(in srgb, var(--text) 10%, transparent), 0 1px 3px 0 rgb(0 0 0 / 10%), 0 1px 2px -1px rgb(0 0 0 / 10%); font-size: 13px; pointer-events: auto; transform: translateX(-50%); white-space: nowrap; }
	.status { padding: 0 8px 0 6px; color: var(--weak); }
	.bar button { gap: 6px; height: 36px; padding: 0 10px; border-radius: 9px; font-weight: 450; }
	.cancel:hover { background: var(--hover); }
	.send { background: var(--brand); color: var(--on-brand); }
	.send:hover:not(:disabled) { background: var(--brand-active); }
	.send:disabled { opacity: 0.5; cursor: default; }
`;

export const NOTE_EDITOR_SCRIPT = String.raw`
(() => {
	const KEY = '__studioNoteEditorDispose';
	if (typeof window[KEY] === 'function') window[KEY]();
	const abort = new AbortController();
	const call = (action) => window['${ NOTE_EDITOR_BINDING }']?.(action);
	const host = document.createElement('div');
	host.id = '__studio-note-editor';
	host.dataset.studioInspector = '';
	host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
	document.documentElement.append(host);
	const root = host.attachShadow({ mode: 'open' });
	const style = document.createElement('style');
	style.textContent = ${ JSON.stringify( STYLE ) };
	root.append(style);

	function el(tag, props, children) {
		const node = Object.assign(document.createElement(tag), props);
		if (children) node.append(...children);
		return node;
	}
	function icon(d) {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		svg.append(path);
		return svg;
	}

	const images = el('ul', { className: 'images' });
	const input = el('textarea', { rows: 1, maxLength: 10000 });
	const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true });
	const attach = el('button', { type: 'button', className: 'tool' }, [icon('m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551')]);
	const remove = el('button', { type: 'button', className: 'tool' }, [icon('M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')]);
	const save = el('button', { type: 'button', className: 'save' }, [icon('M12 20L12 5M17 10L12 5L7 10')]);
	const editor = el('div', { className: 'editor', role: 'group', hidden: true }, [images, input, el('div', { className: 'toolbar' }, [attach, remove, file, save])]);
	const status = el('span', { className: 'status' });
	const cancel = el('button', { type: 'button', className: 'cancel' });
	const send = el('button', { type: 'button', className: 'send' });
	const bar = el('div', { className: 'bar', role: 'toolbar' }, [status, cancel, send]);
	root.append(editor, bar);

	let note = null;
	let anchor = null;

	function hasContent() {
		return !!note && (input.value.trim() !== '' || note.images.length > 0);
	}
	function changed(withImages) {
		save.disabled = !hasContent();
		call({ type: 'change', id: note.id, comment: input.value, ...(withImages ? { images: note.images } : {}) });
	}
	function renderImages() {
		images.hidden = !note.images.length;
		images.replaceChildren(
			...note.images.map((image) => {
				const drop = el('button', { type: 'button', ariaLabel: labels.removeImage }, [icon('M17 7 7 17M7 7l10 10')]);
				drop.onclick = () => {
					note.images = note.images.filter((item) => item !== image);
					renderImages();
					changed(true);
				};
				return el('li', {}, [el('img', { src: image.src, alt: image.name }), drop]);
			})
		);
	}
	function addFiles(files) {
		for (const item of files) {
			if (!/^image\/(png|jpeg|gif|webp)$/.test(item.type)) continue;
			const reader = new FileReader();
			reader.onload = () => {
				if (!note) return;
				note.images = [...note.images, { id: Math.random().toString(36).slice(2), name: item.name || 'image', src: reader.result }];
				renderImages();
				changed(true);
			};
			reader.readAsDataURL(item);
		}
	}
	function place() {
		editor.hidden = !note || !anchor;
		if (editor.hidden) return;
		const left = Math.max(8, Math.min(anchor.left + 8, innerWidth - editor.offsetWidth - 8));
		const top = Math.max(8, Math.min(anchor.top + 8, innerHeight - editor.offsetHeight - 72));
		Object.assign(editor.style, { left: left + 'px', top: top + 'px' });
	}

	let labels = {};
	window.addEventListener(
		'${ NOTE_EDITOR_EVENT }',
		(e) => {
			const detail = e.detail || {};
			if (detail.labels) {
				labels = detail.labels;
				host.dir = labels.rtl ? 'rtl' : 'ltr';
				input.placeholder = labels.placeholder;
				input.ariaLabel = labels.placeholder;
				editor.ariaLabel = labels.annotation;
				attach.ariaLabel = attach.title = labels.attach;
				remove.ariaLabel = remove.title = labels.remove;
				save.ariaLabel = save.title = labels.save;
				bar.ariaLabel = labels.annotations;
				cancel.textContent = labels.cancel;
				send.textContent = labels.send;
				send.ariaLabel = labels.sendCount;
				status.textContent = labels.status;
				send.disabled = !detail.count;
			}
			if ('editing' in detail) {
				const opened = detail.editing && detail.editing.id !== note?.id;
				note = detail.editing ? { id: detail.editing.id, images: detail.editing.images } : null;
				if (opened) input.value = detail.editing.comment;
				if (note) renderImages();
				save.disabled = !hasContent();
				editor.hidden = !note;
				if (opened) requestAnimationFrame(() => input.focus());
			}
			if ('anchor' in detail) anchor = detail.anchor;
			place();
		},
		{ signal: abort.signal }
	);
	input.addEventListener('input', () => changed(false));
	input.addEventListener('keydown', (e) => {
		if (e.isComposing || e.key !== 'Enter' || e.shiftKey) return;
		e.preventDefault();
		if (hasContent()) call({ type: 'save' });
	});
	input.addEventListener('paste', (e) => {
		const files = Array.from(e.clipboardData?.files || []);
		if (!files.length) return;
		e.preventDefault();
		addFiles(files);
	});
	editor.addEventListener('dragover', (e) => e.preventDefault());
	editor.addEventListener('drop', (e) => {
		e.preventDefault();
		addFiles(Array.from(e.dataTransfer?.files || []));
	});
	attach.onclick = () => file.click();
	file.onchange = () => {
		addFiles(Array.from(file.files || []));
		file.value = '';
	};
	remove.onclick = () => call({ type: 'delete', id: note.id });
	save.onclick = () => call({ type: 'save' });
	cancel.onclick = () => call({ type: 'cancel' });
	send.onclick = () => call({ type: 'send' });
	new ResizeObserver(place).observe(editor);
	window.addEventListener('resize', place, { signal: abort.signal });
	window[KEY] = () => {
		abort.abort();
		host.remove();
		delete window[KEY];
	};
})();
`;
