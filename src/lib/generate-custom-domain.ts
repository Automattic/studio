import { sanitizeFolderName } from './generate-site-name';

/**
 * Generates a suitable domain name from site name
 */
export const generateCustomDomainFromSiteName = ( siteName: string ): string => {
	const domainBase = sanitizeFolderName( siteName );

	return `${ domainBase }.wp.local`;
};
