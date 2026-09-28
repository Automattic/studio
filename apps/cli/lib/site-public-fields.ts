// Fields `studio list --format json` prints to stdout. Anything not listed here
// (admin passwords, internal bookkeeping, future secrets) is omitted by default.
export const SITE_LIST_PUBLIC_FIELDS = [
	'id',
	'name',
	'path',
	'port',
	'url',
	'running',
	'status',
	'operation',
	'phpVersion',
	'runtime',
	'fileAccess',
	'customDomain',
	'enableHttps',
	'adminUsername',
	'adminEmail',
	'isWpAutoUpdating',
	'enableXdebug',
	'enableDebugLog',
	'enableDebugDisplay',
	'landingPage',
] as const;

export type SiteListPublicField = ( typeof SITE_LIST_PUBLIC_FIELDS )[ number ];

const PUBLIC_FIELD_SET: ReadonlySet< string > = new Set( SITE_LIST_PUBLIC_FIELDS );

export function pickPublicSiteFields< T extends object >(
	record: T
): Pick< T, Extract< keyof T, SiteListPublicField > > {
	return Object.fromEntries(
		Object.entries( record ).filter( ( [ key ] ) => PUBLIC_FIELD_SET.has( key ) )
	) as Pick< T, Extract< keyof T, SiteListPublicField > >;
}
