/**
 * Generates a suitable domain name from site name
 */
export const generateCustomDomainFromSiteName = ( siteName: string ): string => {
	// Convert the site name to lowercase and replace spaces with hyphens
	const domainBase = siteName
		.toLowerCase()
		.replace( /[^a-z0-9-]/g, '-' ) // Replace non-alphanumeric chars with hyphens
		.replace( /-+/g, '-' ) // Replace multiple hyphens with single hyphen
		.replace( /^-|-$/g, '' ); // Remove hyphens from start and end

	return `${ domainBase }.wp.local`;
};
