import { z } from 'zod';
import { SITE_RUNTIME_NATIVE_PHP, type SiteRuntime } from '@studio/common/lib/site-runtime';

export const SITE_FILE_ACCESS_SITE_DIRECTORY = 'site-directory' as const;
export const SITE_FILE_ACCESS_ALL_FILES = 'all-files' as const;

export const siteFileAccessSchema = z.enum( [
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	SITE_FILE_ACCESS_ALL_FILES,
] );
export type SiteFileAccess = z.infer< typeof siteFileAccessSchema >;

export function getSiteFileAccess( site: { fileAccess?: SiteFileAccess } ): SiteFileAccess {
	return site.fileAccess ?? SITE_FILE_ACCESS_SITE_DIRECTORY;
}

// The Playground sandbox can only ever access the site directory, so
// "all files" is only valid for the native PHP runtime.
export function isFileAccessAllowedForRuntime(
	runtime: SiteRuntime,
	fileAccess: SiteFileAccess
): boolean {
	return fileAccess !== SITE_FILE_ACCESS_ALL_FILES || runtime === SITE_RUNTIME_NATIVE_PHP;
}
