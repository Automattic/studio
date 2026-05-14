import { decodeEntities } from '@wordpress/html-entities';

export interface SiteIdentitySettings {
	title: string;
	tagline: string;
	siteIconId: number;
	siteIconUrl: string;
}

export function parseSiteIdentitySettings( body: string ): SiteIdentitySettings {
	const parsed = parseJsonObject( body ) ?? {};

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
		return parsed && typeof parsed === 'object' && ! Array.isArray( parsed ) ? parsed : null;
	} catch {
		return null;
	}
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
