interface HasTextInfo {
	textInfo: { direction: 'ltr' | 'rtl' };
}

let cachedResult: boolean | null = null;

/**
 * Returns true when the window frame's language (not the language set in the app)
 * is right-to-left.
 */
export function isWindowFrameRtl(): boolean {
	if ( null === cachedResult ) {
		// If `textInfo` is removed in a future version of Electron, we might need to change it to `getTextInfo()`
		// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/getTextInfo
		cachedResult =
			'rtl' ===
			( new Intl.Locale( navigator.language ) as unknown as HasTextInfo ).textInfo.direction;
	}

	return cachedResult;
}
