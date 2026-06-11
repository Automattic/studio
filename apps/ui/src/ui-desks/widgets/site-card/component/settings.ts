import { decodeEntities } from '@wordpress/html-entities';

export interface SiteIdentitySettings {
	title: string;
	tagline: string;
	siteIconId: number;
	siteIconUrl: string;
}

export function parseSiteIdentitySettings( value: unknown ): SiteIdentitySettings {
	const parsed =
		typeof value === 'string' ? parseJsonObject( value ) ?? {} : getJsonObject( value ) ?? {};

	return {
		title: typeof parsed.title === 'string' ? decodeEntities( parsed.title ) : '',
		tagline: typeof parsed.description === 'string' ? decodeEntities( parsed.description ) : '',
		siteIconId: typeof parsed.site_icon === 'number' ? parsed.site_icon : 0,
		siteIconUrl: getSiteIconUrl( parsed ),
	};
}

export function parseJsonObject( body: string ): Record< string, unknown > | null {
	try {
		const parsed = JSON.parse( body );
		return getJsonObject( parsed );
	} catch {
		return null;
	}
}

function getJsonObject( value: unknown ): Record< string, unknown > | null {
	return value && typeof value === 'object' && ! Array.isArray( value )
		? ( value as Record< string, unknown > )
		: null;
}

function getSiteIconUrl( parsed: Record< string, unknown > ) {
	if ( typeof parsed.site_icon_url === 'string' ) {
		return parsed.site_icon_url;
	}

	if ( typeof parsed.site_logo_url === 'string' ) {
		return parsed.site_logo_url;
	}

	return '';
}
