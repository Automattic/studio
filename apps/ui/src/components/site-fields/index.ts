/**
 * Shared DataForm field builders used by both the create-site form and the
 * site-settings form. Field IDs are fixed (so consumers must use the matching
 * keys in their form data), but the generic `T` parameter keeps per-form type
 * safety when `isValid.custom` / `isVisible` need to read other fields on the
 * same record.
 */

import { DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import { validateAdminEmail, validateAdminUsername } from '@studio/common/lib/passwords';
import { getAutoUpdateVersionLabel } from '@studio/common/lib/wordpress-version-labels';
import {
	isWordPressBetaVersion,
	isWordPressDevVersion,
} from '@studio/common/lib/wordpress-version-utils';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { WpVersionControl } from '@/components/site-fields/wp-version-control';
import type { WpVersionOption } from '@/components/site-fields/wp-version-control';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { Field, Option } from '@wordpress/dataviews';

const PHP_VERSION_ELEMENTS = SupportedPHPVersions.map( ( version ) => ( {
	value: version,
	label: version,
} ) );

export function siteNameField< T extends { name: string } >(): Field< T > {
	return {
		id: 'name',
		type: 'text',
		label: __( 'Site name' ),
		isValid: { required: true },
	};
}

export function phpVersionField< T extends { phpVersion: SupportedPHPVersion } >(): Field< T > {
	return {
		id: 'phpVersion',
		type: 'text',
		label: __( 'PHP version' ),
		elements: PHP_VERSION_ELEMENTS,
	};
}

// Numeric compare on the leading `x.y.z` part, like Classic's semver.coerce
// (`6.9-beta1` sorts with `6.9`; unparseable values sort last).
function compareWpVersions( a: string, b: string ): number {
	const parse = ( version: string ) =>
		( version.match( /^\d+(\.\d+)*/ )?.[ 0 ] ?? '' ).split( '.' ).map( Number );
	const [ aParts, bParts ] = [ parse( a ), parse( b ) ];
	for ( let i = 0; i < Math.max( aParts.length, bParts.length ); i++ ) {
		const diff = ( aParts[ i ] ?? 0 ) - ( bParts[ i ] ?? 0 );
		if ( diff !== 0 ) {
			return diff;
		}
	}
	return 0;
}

// Insert `option` into the descending-ordered `options` list (ported from the
// legacy wp-version-selector's addWpVersionToList).
function addVersionOption< T extends Option >( option: T, options: T[] ): T[] {
	const index = options.findIndex(
		( existing ) => compareWpVersions( option.value, existing.value ) > 0
	);
	return index === -1
		? [ ...options, option ]
		: [ ...options.slice( 0, index ), option, ...options.slice( index ) ];
}

export function wpVersionField< T extends { wpVersion: string } >(
	placeholder: string,
	versions?: WordPressVersion[],
	{
		latestValue = DEFAULT_WORDPRESS_VERSION,
		currentVersion,
		offline = false,
		offlineMessage = __( 'Changing WordPress version requires an internet connection.' ),
	}: {
		latestValue?: string;
		currentVersion?: string;
		offline?: boolean;
		offlineMessage?: string;
	} = {}
): Field< T > {
	const field: Field< T > = {
		id: 'wpVersion',
		type: 'text',
		label: __( 'WordPress version' ),
		placeholder,
	};
	if ( offline ) {
		// Like the legacy selector: only "latest" can be applied without a
		// download, so the control locks while offline (the form forces the
		// value to "latest") and the message shows as a hover tooltip.
		field.isDisabled = true;
		field.description = offlineMessage;
	}
	const offers = versions ?? [];
	// The settings form (custom `latestValue`) and the offline state always
	// render a select even when the version list is unavailable — offering
	// only versions we can actually install. Otherwise the create form keeps
	// its free-text fallback.
	if ( offers.length || latestValue !== DEFAULT_WORDPRESS_VERSION || offline ) {
		const toOption = (
			{ value, label }: { value: string; label: string },
			group: WpVersionOption[ 'group' ]
		): WpVersionOption => ( { value, label, group, current: value === currentVersion } );
		let prerelease = offers
			.filter( ( version ) => version.isBeta || version.isDevelopment )
			.map( ( version ) => toOption( version, 'prerelease' ) );
		let stable = offers
			.filter(
				( version ) =>
					version.value !== DEFAULT_WORDPRESS_VERSION && ! version.isBeta && ! version.isDevelopment
			)
			.map( ( version ) => toOption( version, 'stable' ) );
		// The site's installed version may predate the fetched offers — keep it
		// selectable, sorted into the right group, like the legacy selector's
		// extraOptions.
		if ( currentVersion && ! offers.some( ( version ) => version.value === currentVersion ) ) {
			const offer = { value: currentVersion, label: currentVersion };
			if ( isWordPressBetaVersion( currentVersion ) || isWordPressDevVersion( currentVersion ) ) {
				prerelease = addVersionOption( toOption( offer, 'prerelease' ), prerelease );
			} else {
				stable = addVersionOption( toOption( offer, 'stable' ), stable );
			}
		}
		const options: WpVersionOption[] = [
			{ value: latestValue, label: getAutoUpdateVersionLabel(), group: 'latest' },
			...prerelease,
			...stable,
		];
		if ( latestValue !== DEFAULT_WORDPRESS_VERSION ) {
			// The settings form maps "latest" to '' (auto-update) but falls back
			// to seeding pinned sites with DEFAULT_WORDPRESS_VERSION when their
			// installed version can't be read. Keep that seed renderable without
			// offering it, and out of the auto-update group: the site is pinned,
			// so an "Auto-update" readout there would be wrong.
			options.push( {
				value: DEFAULT_WORDPRESS_VERSION,
				/* translators: WordPress version option for a pinned site whose installed version Studio cannot read. */
				label: __( 'Unknown version' ),
				group: 'stable',
				hidden: true,
			} );
		}
		field.elements = options;
		field.Edit = WpVersionControl;
	}
	return field;
}

export function adminUsernameField< T extends { adminUsername: string } >(): Field< T > {
	return {
		id: 'adminUsername',
		type: 'text',
		label: __( 'Admin username' ),
		isValid: {
			required: true,
			custom: ( item: T ) => validateAdminUsername( item.adminUsername ) || null,
		},
	};
}

export function adminPasswordField< T extends { adminPassword: string } >(): Field< T > {
	return {
		id: 'adminPassword',
		type: 'password',
		label: __( 'Admin password' ),
		isValid: { required: true },
	};
}

export function adminEmailField< T extends { adminEmail: string } >(): Field< T > {
	return {
		id: 'adminEmail',
		type: 'email',
		// The default email control prefixes the input with an envelope icon;
		// use the plain text control instead (email-type validation still applies).
		Edit: 'text',
		label: __( 'Admin email' ),
		isValid: {
			required: true,
			custom: ( item: T ) => validateAdminEmail( item.adminEmail ) || null,
		},
	};
}

// Builds the "use custom domain" boolean field. Named `customDomainToggleField`
// (not `useCustomDomainField`) so the react-hooks/rules-of-hooks rule doesn't
// flag it as a hook.
export function customDomainToggleField< T extends { useCustomDomain: boolean } >(): Field< T > {
	return {
		id: 'useCustomDomain',
		type: 'boolean',
		label: __( 'Use custom domain' ),
		description: __( 'Your system password will be required to set up the domain.' ),
	};
}

/**
 * Builder for the domain-name text field. The existing-domains list is passed
 * in (not read from a hook) so the same field definition works in both the
 * create and settings forms — each form fetches the list with its own filter
 * rules (e.g. settings excludes the current site's domain).
 */
export function customDomainField<
	T extends { useCustomDomain: boolean; customDomain: string; name: string },
>( existingDomainNames: string[] ): Field< T > {
	return {
		id: 'customDomain',
		type: 'text',
		label: __( 'Domain name' ),
		isVisible: ( item: T ) => item.useCustomDomain,
		isValid: {
			custom: ( item: T ) => {
				const value = item.customDomain || generateCustomDomainFromSiteName( item.name );
				return (
					getDomainNameValidationError( item.useCustomDomain, value, existingDomainNames ) || null
				);
			},
		},
	};
}

export function enableXdebugField< T extends { enableXdebug: boolean } >( {
	conflictingSiteName,
}: { conflictingSiteName?: string } = {} ): Field< T > {
	return {
		id: 'enableXdebug',
		type: 'boolean',
		label: __( 'Enable Xdebug' ),
		description: conflictingSiteName
			? /* translators: %s: other site's name */
			  `${ __( 'Xdebug is enabled on another site:' ) } ${ conflictingSiteName }`
			: __( 'Enable PHP debugging with Xdebug. Only one site can have Xdebug enabled at a time.' ),
	};
}

export function enableDebugLogField< T extends { enableDebugLog: boolean } >(): Field< T > {
	return {
		id: 'enableDebugLog',
		type: 'boolean',
		label: __( 'Enable debug log' ),
		description: __(
			"Log PHP errors and warnings to a debug.log file in your site's wp-content directory."
		),
	};
}

export function enableDebugDisplayField< T extends { enableDebugDisplay: boolean } >(): Field< T > {
	return {
		id: 'enableDebugDisplay',
		type: 'boolean',
		label: __( 'Show errors in browser' ),
		description: __( 'Display PHP errors and warnings directly in the browser.' ),
	};
}
