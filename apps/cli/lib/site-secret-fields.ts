export const SITE_SECRET_FIELD_KEYS = [ 'adminPassword', 'tlsKey', 'tlsCert' ] as const;

export type SiteSecretField = ( typeof SITE_SECRET_FIELD_KEYS )[ number ];

export function omitSiteSecretFields< T extends object >( record: T ): Omit< T, SiteSecretField > {
	const publicRecord = { ...record } as T & Partial< Record< SiteSecretField, unknown > >;
	for ( const key of SITE_SECRET_FIELD_KEYS ) {
		delete publicRecord[ key ];
	}
	return publicRecord;
}
