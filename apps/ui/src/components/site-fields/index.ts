/**
 * Shared DataForm field builders used by both the create-site form and the
 * site-settings form. Field IDs are fixed (so consumers must use the matching
 * keys in their form data), but the generic `T` parameter keeps per-form type
 * safety when `isValid.custom` / `isVisible` need to read other fields on the
 * same record.
 */

import {
	generateCustomDomainFromSiteName,
	getDomainNameValidationError,
} from '@studio/common/lib/domains';
import { validateAdminEmail, validateAdminUsername } from '@studio/common/lib/passwords';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { Field } from '@wordpress/dataviews';

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

/**
 * Builder for the WordPress version field. With a fetched `versions` list it
 * renders a select ordered like the desktop renderer's version picker —
 * auto-updating "latest" first, then nightly/beta, then stable releases.
 * Without one (offline, fetch failed, still loading) it stays a free-text
 * input so site creation is never blocked on the wordpress.org API.
 */
export function wpVersionField< T extends { wpVersion: string } >(
	placeholder: string,
	versions?: WordPressVersion[]
): Field< T > {
	const field: Field< T > = {
		id: 'wpVersion',
		type: 'text',
		label: __( 'WordPress version' ),
		placeholder,
	};
	if ( versions?.length ) {
		const beta = versions.filter( ( version ) => version.isBeta || version.isDevelopment );
		const stable = versions.filter(
			( version ) => version.value !== 'latest' && ! version.isBeta && ! version.isDevelopment
		);
		field.elements = [
			...versions
				.filter( ( version ) => version.value === 'latest' )
				.map( ( version ) => ( { value: version.value, label: __( 'latest' ) } ) ),
			...beta.map( ( version ) => ( { value: version.value, label: version.label } ) ),
			...stable.map( ( version ) => ( { value: version.value, label: version.label } ) ),
		];
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
