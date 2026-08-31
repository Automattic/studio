import { __ } from '@wordpress/i18n';
import { DEFAULT_CUSTOM_DOMAIN_SUFFIX } from '@studio/common/constants';
import { sanitizeFolderName } from './sanitize-folder-name';

const DOMAIN_PATTERN =
	/^(?!-)[\p{L}\p{N}][\p{L}\p{N}-]{0,61}[\p{L}\p{N}](?<!-)(?:\.(?!-)[\p{L}\p{N}-]{1,61}[\p{L}\p{N}](?<!-))+$/u;

/**
 * Generates a suitable domain name from site name
 */
export const generateCustomDomainFromSiteName = ( siteName: string ): string => {
	const domainBase = sanitizeFolderName( siteName );

	return `${ domainBase }${ DEFAULT_CUSTOM_DOMAIN_SUFFIX }`;
};

export const stripLocalDomainSuffix = ( domain: string ): string => {
	if ( domain.endsWith( DEFAULT_CUSTOM_DOMAIN_SUFFIX ) ) {
		return domain.slice( 0, -DEFAULT_CUSTOM_DOMAIN_SUFFIX.length );
	}
	if ( domain.endsWith( '.local' ) ) {
		return domain.slice( 0, -'.local'.length );
	}
	return domain;
};

export const getDomainNameValidationError = (
	useCustomDomain: boolean,
	domainName: string | null,
	existingDomainNames: string[]
): string => {
	if ( ! useCustomDomain ) {
		return '';
	}

	if ( ! domainName ) {
		return __( 'The domain name is required' );
	}

	if ( existingDomainNames.includes( domainName ) ) {
		return __( 'The domain name is already in use' );
	}

	if ( ! DOMAIN_PATTERN.test( domainName ) ) {
		return __( 'Please enter a valid domain name' );
	}

	if ( domainName.length > 253 ) {
		return __( 'The domain name is too long' );
	}

	if ( ! domainName.endsWith( '.local' ) ) {
		return __( 'The domain name must end with .local' );
	}

	return '';
};
