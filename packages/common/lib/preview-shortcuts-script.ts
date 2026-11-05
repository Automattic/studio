export const PREVIEW_SHORTCUTS_SCRIPT = `(() => {
	if (window.parent === window) return;
	let hostOrigin;
	let apple;
	window.addEventListener('message', (event) => {
		if (event.source !== window.parent || event.data?.type !== 'studio:preview-shortcuts:init') return;
		if ((!event.origin.startsWith('http://') && !event.origin.startsWith('https://')) || typeof event.data.apple !== 'boolean') return;
		hostOrigin = event.origin;
		apple = event.data.apple;
	});
	document.addEventListener('keydown', (event) => {
		if (!hostOrigin || location.pathname.split('/').includes('wp-admin')) return;
		const primary = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
		if (!primary || event.altKey || event.shiftKey || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return;
		if (event.code !== 'KeyK') return;
		event.preventDefault();
		event.stopPropagation();
		window.parent.postMessage({ type: 'studio:preview-shortcuts:command-palette' }, hostOrigin);
	}, true);
})();`;
