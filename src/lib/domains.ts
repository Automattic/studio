import { __ } from '@wordpress/i18n';
import { sanitizeFolderName } from './generate-site-name';

/**
 * Generates a suitable domain name from site name
 */
export const generateCustomDomainFromSiteName = ( siteName: string ): string => {
	const domainBase = sanitizeFolderName( siteName );

	return `${ domainBase }.wp.local`;
};

export const validateDomainName = (
	useCustomDomain: boolean,
	domainName: string | null
): string => {
	// Validate custom domain if enabled
	const domainPattern =
		/^(?!-)[\p{L}\p{N}][\p{L}\p{N}-]{0,61}[\p{L}\p{N}](?<!-)(?:\.(?!-)[\p{L}\p{N}-]{1,61}[\p{L}\p{N}](?<!-))+$/u;
	if ( useCustomDomain && domainName && ! domainPattern.test( domainName ) ) {
		return __( 'Please enter a valid domain name' );
	}

	if ( useCustomDomain && domainName && domainName.length > 253 ) {
		return __( 'The domain name is too long' );
	}

	if ( useCustomDomain && domainName === '' ) {
		return __( 'The domain name is required' );
	}

	if ( useCustomDomain && domainName && ! domainName.endsWith( '.local' ) ) {
		return __( 'The domain name must end with .local' );
	}

	return '';
};
