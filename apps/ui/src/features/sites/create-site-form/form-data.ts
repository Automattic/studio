import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	generatePassword,
} from '@studio/common/lib/passwords';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

export interface CreateSiteFormValues {
	name: string;
	path: string;
	phpVersion: SupportedPHPVersion;
	fileAccess: SiteFileAccess;
	wpVersion: string;
	customDomain?: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

export interface FormData {
	name: string;
	path: string;
	// Stops the name→path auto-gen from overriding a manually picked folder.
	hasCustomPath: boolean;
	pathError: string;
	isWordPress: boolean;
	// Suppresses the path field's required check during the auto-gen async
	// window so a seeded name doesn't flash "1 error found" on the Advanced
	// toggle before `generateProposedPath` resolves.
	isPathPending: boolean;
	phpVersion: SupportedPHPVersion;
	fileAccess: SiteFileAccess;
	wpVersion: string;
	useCustomDomain: boolean;
	customDomain: string;
	enableHttps: boolean;
	adminUsername: string;
	adminPassword: string;
	adminEmail: string;
}

const SIMPLE_FIELDS = [
	'name',
	'phpVersion',
	'fileAccess',
	'wpVersion',
	'enableHttps',
	'adminUsername',
	'adminPassword',
	'adminEmail',
] as const satisfies readonly ( keyof CreateSiteFormValues )[];
export const INITIAL_VALUE_FIELDS = [ ...SIMPLE_FIELDS, 'path', 'customDomain' ] as const;

export function createDefaultFormData(): FormData {
	return {
		name: '',
		path: '',
		hasCustomPath: false,
		pathError: '',
		isWordPress: false,
		isPathPending: false,
		phpVersion: RecommendedPHPVersion,
		fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
		wpVersion: DEFAULT_WORDPRESS_VERSION,
		useCustomDomain: false,
		customDomain: '',
		enableHttps: false,
		adminUsername: DEFAULT_ADMIN_USERNAME,
		adminPassword: generatePassword(),
		adminEmail: DEFAULT_ADMIN_EMAIL,
	};
}

export function getSuggestedFields(
	values: Partial< CreateSiteFormValues >
): Set< keyof CreateSiteFormValues > {
	return new Set(
		( Object.keys( values ) as ( keyof CreateSiteFormValues )[] ).filter(
			( field ) => values[ field ] !== undefined
		)
	);
}

export function applyInitialValues(
	prev: FormData,
	values: Partial< CreateSiteFormValues >,
	defaults: FormData,
	previousSuggestedFields: Set< keyof CreateSiteFormValues > = new Set(),
	dirtyFields: Set< keyof CreateSiteFormValues > = new Set()
): FormData {
	const next: FormData = { ...prev };
	const defaultValuesByField: Record< keyof CreateSiteFormValues, Partial< FormData > > = {
		name: { name: defaults.name },
		path: {
			path: defaults.path,
			hasCustomPath: defaults.hasCustomPath,
			pathError: defaults.pathError,
			isWordPress: defaults.isWordPress,
			isPathPending: defaults.isPathPending,
		},
		phpVersion: { phpVersion: defaults.phpVersion },
		fileAccess: { fileAccess: defaults.fileAccess },
		wpVersion: { wpVersion: defaults.wpVersion },
		customDomain: {
			useCustomDomain: defaults.useCustomDomain,
			customDomain: defaults.customDomain,
		},
		enableHttps: { enableHttps: defaults.enableHttps },
		adminUsername: { adminUsername: defaults.adminUsername },
		adminPassword: { adminPassword: defaults.adminPassword },
		adminEmail: { adminEmail: defaults.adminEmail },
	};
	for ( const field of previousSuggestedFields ) {
		if ( values[ field ] !== undefined || dirtyFields.has( field ) ) continue;
		Object.assign( next, defaultValuesByField[ field ] );
	}
	for ( const field of SIMPLE_FIELDS ) {
		if ( values[ field ] !== undefined && ! dirtyFields.has( field ) ) {
			Object.assign( next, { [ field ]: values[ field ] } );
		}
	}
	if ( values.path !== undefined && ! dirtyFields.has( 'path' ) ) {
		next.path = values.path;
		next.hasCustomPath = !! values.path;
		next.pathError = '';
		next.isWordPress = false;
		next.isPathPending = false;
	}
	if ( values.customDomain !== undefined && ! dirtyFields.has( 'customDomain' ) ) {
		next.useCustomDomain = !! values.customDomain;
		next.customDomain = values.customDomain;
	}
	if ( ! next.hasCustomPath && next.name !== prev.name ) {
		next.isPathPending = !! next.name.trim();
		next.pathError = '';
		if ( ! next.name.trim() ) next.path = '';
	}
	return Object.keys( next ).some(
		( key ) => next[ key as keyof FormData ] !== prev[ key as keyof FormData ]
	)
		? next
		: prev;
}

// A change the person made to the form.
export function applyFormChange( prev: FormData, update: Partial< FormData > ): FormData {
	const next: FormData = { ...prev, ...update };
	if ( update.name !== undefined && ! prev.hasCustomPath && next.name !== prev.name ) {
		next.isPathPending = !! next.name.trim();
		next.pathError = '';
		if ( ! next.name.trim() ) next.path = '';
	}
	if ( ! prev.useCustomDomain && next.useCustomDomain && ! next.customDomain ) {
		next.customDomain = generateCustomDomainFromSiteName( next.name );
	}
	return next;
}

export function getSubmittedValues( data: FormData ): CreateSiteFormValues {
	return {
		name: data.name.trim(),
		path: data.path,
		phpVersion: data.phpVersion,
		fileAccess: data.fileAccess,
		wpVersion: data.wpVersion,
		customDomain: data.useCustomDomain
			? data.customDomain || generateCustomDomainFromSiteName( data.name )
			: undefined,
		enableHttps: data.useCustomDomain && data.enableHttps,
		adminUsername: data.adminUsername,
		adminPassword: data.adminPassword,
		adminEmail: data.adminEmail,
	};
}

// The list only offers each branch's newest release, so a Blueprint asking for
// "6.5" or "6.5.5" gets 6.5's newest release (the list is newest-first).
export function findOfferedWpVersion( version: string, offered: WordPressVersion[] = [] ) {
	const branch = version.split( '.' ).slice( 0, 2 ).join( '.' );
	return (
		offered.find( ( { value } ) => value === version )?.value ??
		offered.find( ( { value } ) => value.startsWith( `${ branch }.` ) )?.value
	);
}
