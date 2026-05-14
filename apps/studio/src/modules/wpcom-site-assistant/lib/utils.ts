export const isRecord = ( value: unknown ): value is Record< string, unknown > =>
	typeof value === 'object' && value !== null;

export const flexibleNumber = ( value: unknown ): number | undefined => {
	if ( typeof value === 'number' ) {
		return value;
	}
	if ( typeof value === 'string' ) {
		const parsed = Number( value );
		return Number.isFinite( parsed ) ? parsed : undefined;
	}
	return undefined;
};

export const getFlexibleNumberValue = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): number | undefined => {
	for ( const key of possibleKeys ) {
		const value = flexibleNumber( record[ key ] );
		if ( value && value > 0 ) {
			return value;
		}
	}
};

export const getStringFromRecord = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): string | undefined => {
	for ( const key of possibleKeys ) {
		const value = record[ key ];
		if ( typeof value === 'string' && value.trim() ) {
			return value.trim();
		}
	}
};

export const hasHttpProtocol = ( url: URL ) =>
	url.protocol === 'http:' || url.protocol === 'https:';

export const formatSiteBaseUrl = ( url: URL ) => {
	if ( url.pathname === '/' && ! url.search && ! url.hash ) {
		return url.origin;
	}
	return url.toString();
};

export const normalizeSiteBaseUrl = ( value?: string ): string | undefined => {
	const trimmedValue = value?.trim();
	if ( ! trimmedValue ) {
		return undefined;
	}

	const parseUrl = ( candidate: string ) => {
		try {
			const url = new URL( candidate );
			return hasHttpProtocol( url ) ? formatSiteBaseUrl( url ) : undefined;
		} catch {
			return undefined;
		}
	};

	const normalizedUrl = parseUrl( trimmedValue );
	if ( normalizedUrl ) {
		return normalizedUrl;
	}

	if ( trimmedValue.startsWith( '//' ) ) {
		return parseUrl( `https:${ trimmedValue }` );
	}

	if ( trimmedValue.startsWith( '/' ) ) {
		return undefined;
	}

	return parseUrl( `https://${ trimmedValue }` );
};

export const normalizeDollySessionId = ( value?: string ) => {
	const trimmedValue = value?.trim();
	return trimmedValue || undefined;
};
