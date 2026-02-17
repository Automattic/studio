interface HasTextInfo {
	getTextInfo?: () => { direction: 'ltr' | 'rtl' };
	textInfo?: { direction: 'ltr' | 'rtl' };
}

let cachedResult: boolean | null = null;

/**
 * Returns true when the window frame's language (not the language set in the app)
 * is right-to-left.
 */
export function isWindowFrameRtl(): boolean {
	if ( null === cachedResult ) {
		// `getTextInfo()` replaced the `textInfo` property in Chromium 130+ (Electron 32+)
		// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/getTextInfo
		const locale = new Intl.Locale( navigator.language ) as unknown as HasTextInfo;
		const direction =
			( locale.getTextInfo?.() ?? locale.textInfo )?.direction ?? 'ltr';
		cachedResult = 'rtl' === direction;
	}

	return cachedResult;
}
