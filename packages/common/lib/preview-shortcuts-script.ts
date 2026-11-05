export const READ_ADMIN_BAR_VISIBILITY_SCRIPT = `(() => {
	const bar = document.getElementById('wpadminbar');
	if (!bar) return false;
	if (bar.checkVisibility) return bar.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
	const style = getComputedStyle(bar);
	return bar.getClientRects().length > 0 && style.visibility === 'visible' && style.opacity !== '0';
})()`;

export const PREVIEW_SHORTCUTS_SCRIPT = `(() => {
	if (window.parent === window) return;
	let hostOrigin;
	let apple;
	const reportAdminBar = () => {
		if (!hostOrigin) return;
		window.parent.postMessage({ type: 'studio:preview:admin-bar-state', visible: ${ READ_ADMIN_BAR_VISIBILITY_SCRIPT } }, hostOrigin);
	};
	window.addEventListener('message', (event) => {
		if (event.source !== window.parent) return;
		if (event.data?.type === 'studio:preview:read-admin-bar') {
			if (event.origin === hostOrigin) reportAdminBar();
			return;
		}
		if (event.data?.type === 'studio:preview:login') {
			if (!hostOrigin || event.origin !== hostOrigin || location.pathname.split('/').includes('wp-admin')) return;
			const login = new URL('/studio-auto-login', location.href);
			login.searchParams.set('redirect_to', location.href);
			location.assign(login.toString());
			return;
		}
		if (event.data?.type !== 'studio:preview-shortcuts:init') return;
		if ((!event.origin.startsWith('http://') && !event.origin.startsWith('https://')) || typeof event.data.apple !== 'boolean') return;
		hostOrigin = event.origin;
		apple = event.data.apple;
		reportAdminBar();
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
