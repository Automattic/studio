import { z } from 'zod';

export const SITE_FILE_ACCESS_SITE_DIRECTORY = 'site-directory' as const;
export const SITE_FILE_ACCESS_ALL_FILES = 'all-files' as const;

export const siteFileAccessSchema = z.enum( [
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	SITE_FILE_ACCESS_ALL_FILES,
] );
export type SiteFileAccess = z.infer< typeof siteFileAccessSchema >;

// open_basedir disables PHP's realpath cache, which makes page loads several
// times slower on Windows (#5989). Sites without a stored value predate the
// setting and keep the restricted mode they have always run with.
export const DEFAULT_SITE_FILE_ACCESS: SiteFileAccess = SITE_FILE_ACCESS_ALL_FILES;

export function getSiteFileAccess( site: { fileAccess?: SiteFileAccess } ): SiteFileAccess {
	return site.fileAccess ?? SITE_FILE_ACCESS_SITE_DIRECTORY;
}
