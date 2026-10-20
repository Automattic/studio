import { __, sprintf } from '@wordpress/i18n';
import {
	DEFAULT_CUSTOM_DOMAIN_SUFFIX,
	LOCAL_DOMAIN_SUFFIX,
	PROXY_PROCESS_NAME,
} from '@studio/common/constants';
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
	if ( domain.endsWith( LOCAL_DOMAIN_SUFFIX ) ) {
		return domain.slice( 0, -LOCAL_DOMAIN_SUFFIX.length );
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

	if ( ! domainName.endsWith( LOCAL_DOMAIN_SUFFIX ) ) {
		return __( 'The domain name must end with .local' );
	}

	return '';
};

/**
 * Explains a custom domain proxy that couldn't start because another app holds port 80 or 443,
 * given the error of the failed start. Returns undefined for any other error.
 */
export function getProxyPortConflictMessage( errorMessage: string ): string | undefined {
	const port = /EADDRINUSE\b.*?:(80|443)\b/.exec( errorMessage )?.[ 1 ];
	if ( ! port || ! errorMessage.includes( PROXY_PROCESS_NAME ) ) {
		return undefined;
	}
	return sprintf(
		/* translators: %s: port number, 80 or 443 */
		__(
			'Another app is using port %s, which Studio needs for custom domains. Quit that app and try again, or turn off the custom domain to use localhost'
		),
		port
	);
}
