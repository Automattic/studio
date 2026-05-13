export function normalizeHttpUrl( value: string ) {
	const trimmed = value.trim();
	if ( ! trimmed || /\s/.test( trimmed ) ) {
		return null;
	}
	if ( ! /^https?:\/\//i.test( trimmed ) ) {
		return null;
	}

	try {
		const url = new URL( trimmed );
		if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) {
			return null;
		}

		return url.href;
	} catch {
		return null;
	}
}

export function isHttpUrl( value: string ) {
	return normalizeHttpUrl( value ) !== null;
}

export function getUrlHostname( value: string ) {
	try {
		return new URL( value ).hostname.replace( /^www\./, '' );
	} catch {
		return value;
	}
}

export function getFaviconUrl( value: string ) {
	try {
		const url = new URL( value );
		return `${ url.origin }/favicon.ico`;
	} catch {
		return '';
	}
}
