import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { generateCustomDomainFromSiteName } from '@studio/common/lib/domains';
import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_USERNAME,
	generatePassword,
} from '@studio/common/lib/passwords';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { RecommendedPHPVersion } from '@studio/common/types/php-versions';
import { getFolderNameError, splitFolderPath } from './folder-path';
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

export type CreateSiteFormDraft = Partial< CreateSiteFormValues > & {
	isWordPress?: boolean;
	matchSiteName?: boolean;
};

export interface FormData {
	name: string;
	path: string;
	// Stops the name→path auto-gen from overriding a manually picked folder.
	hasCustomPath: boolean;
	matchSiteName: boolean;
	pathError: string;
	isWordPress: boolean;
	// Suppresses the required-path check while its suggested value is pending.
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
		matchSiteName: false,
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
			( field ) => INITIAL_VALUE_FIELDS.includes( field ) && values[ field ] !== undefined
		)
	);
}

export function applyInitialValues(
	prev: FormData,
	values: CreateSiteFormDraft,
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
			matchSiteName: defaults.matchSiteName,
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
		next.isWordPress = !! values.path && !! values.isWordPress;
		next.matchSiteName = !! values.path && !! values.matchSiteName && ! next.isWordPress;
		next.pathError = '';
		next.isPathPending = false;
	}
	if ( values.customDomain !== undefined && ! dirtyFields.has( 'customDomain' ) ) {
		next.useCustomDomain = !! values.customDomain;
		next.customDomain = values.customDomain;
	}
	updatePathForSiteName( prev, next );
	return Object.keys( next ).some(
		( key ) => next[ key as keyof FormData ] !== prev[ key as keyof FormData ]
	)
		? next
		: prev;
}

// A change the person made to the form.
export function applyFormChange( prev: FormData, update: Partial< FormData > ): FormData {
	const next: FormData = { ...prev, ...update };
	updatePathForSiteName( prev, next );
	if ( ! prev.useCustomDomain && next.useCustomDomain && ! next.customDomain ) {
		next.customDomain = generateCustomDomainFromSiteName( next.name );
	}
	return next;
}

function updatePathForSiteName( prev: FormData, next: FormData ) {
	if (
		next.name === prev.name &&
		next.path === prev.path &&
		next.matchSiteName === prev.matchSiteName
	)
		return;
	if ( ! next.hasCustomPath ) {
		next.isPathPending = !! next.name.trim();
		next.pathError = '';
		if ( ! next.name.trim() ) next.path = '';
	} else if ( next.matchSiteName ) {
		const name = sanitizeFolderName( next.name );
		next.path = splitFolderPath( next.path ).parent + name;
		next.pathError = next.name.trim() ? getFolderNameError( name ) : '';
		next.isWordPress = false;
		next.isPathPending = ! next.pathError;
	}
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
