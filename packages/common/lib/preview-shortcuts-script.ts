export const READ_ADMIN_BAR_VISIBILITY_SCRIPT = `(() => {
	if (document.contentType && document.contentType !== 'text/html') return null;
	const bar = document.getElementById('wpadminbar');
	if (!bar) return false;
	if (bar.checkVisibility) return bar.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
	const style = getComputedStyle(bar);
	return bar.getClientRects().length > 0 && style.visibility === 'visible' && style.opacity !== '0';
})()`;

export const READ_AUTO_LOGIN_SCRIPT = `(() => {
	const loggedIn = document.documentElement.getAttribute('data-studio-auto-login') === 'true';
	document.documentElement.removeAttribute('data-studio-auto-login');
	return loggedIn;
})()`;

export const PREVIEW_SHORTCUTS_SCRIPT = `(() => {
	const script = document.currentScript;
	const loginCookie = script?.dataset.studioAutoLoginCookie;
	if (loginCookie && document.cookie.split(';').some((cookie) => cookie.trim() === loginCookie + '=1')) {
		document.cookie = loginCookie + '=; Max-Age=0; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
		if (script.dataset.studioLoggedIn === 'true') document.documentElement.setAttribute('data-studio-auto-login', 'true');
	}
	if (window.parent === window) return;
	let hostOrigin;
	let apple;
	let navigationId;
	const reportAdminBar = () => {
		if (!hostOrigin) return;
		window.parent.postMessage({ type: 'studio:preview:admin-bar-state', visible: ${ READ_ADMIN_BAR_VISIBILITY_SCRIPT }, url: location.href, title: document.title, navigationId }, hostOrigin);
	};
	window.addEventListener('pagehide', () => {
		if (hostOrigin) window.parent.postMessage({ type: 'studio:preview:navigating', navigationId }, hostOrigin);
	});
	window.addEventListener('pageshow', reportAdminBar);
	window.addEventListener('hashchange', reportAdminBar);
	window.addEventListener('popstate', reportAdminBar);
	window.addEventListener('message', (event) => {
		if (event.source !== window.parent) return;
		if (event.data?.type === 'studio:preview:read-admin-bar') {
			if (event.origin === hostOrigin) reportAdminBar();
			return;
		}
		if (event.data?.type === 'studio:preview:login') {
			if (!hostOrigin || event.origin !== hostOrigin || location.pathname.split('/').some((part) => ['wp-admin', 'wp-login.php', 'wp-signup.php', 'wp-activate.php'].includes(part))) return;
			const login = new URL('/studio-auto-login', location.href);
			login.searchParams.set('redirect_to', location.href);
			location.assign(login.toString());
			return;
		}
		if (event.data?.type !== 'studio:preview-shortcuts:init') return;
		if ((!event.origin.startsWith('http://') && !event.origin.startsWith('https://')) || typeof event.data.apple !== 'boolean') return;
		hostOrigin = event.origin;
		apple = event.data.apple;
		navigationId = event.data.navigationId;
		reportAdminBar();
		if (${ READ_AUTO_LOGIN_SCRIPT }) window.parent.postMessage({ type: 'studio:preview:auto-login', navigationId }, hostOrigin);
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
