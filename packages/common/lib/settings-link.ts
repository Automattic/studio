// A link to one setting, which the Desktop app opens through its deep link:
// `wp-studio://app/v1/settings?id=language`.
export function buildSettingsLink( id: string ): string {
	return `wp-studio://app/v1/settings?id=${ encodeURIComponent( id ) }`;
}

export function parseSettingsLink( value: string ): { id: string } | null {
	try {
		const url = new URL( value );
		if (
			url.protocol !== 'wp-studio:' ||
			url.host !== 'app' ||
			url.pathname !== '/v1/settings' ||
			url.username ||
			url.password
		) {
			return null;
		}
		const id = url.searchParams.get( 'id' );
		return id && /^[a-z][a-z0-9-]{0,79}$/.test( id ) ? { id } : null;
	} catch {
		return null;
	}
}
