import type { SiteFileAccess } from '@studio/common/lib/site-file-access';

// A local site's details as `site status` reports them.
export interface SiteStatus {
	url: string;
	// Logs into wp-admin; only while the site is running.
	autoLoginUrl?: string;
	path: string;
	// The folder the email the site sends is saved in.
	emailPath: string;
	running: boolean;
	phpVersion: string;
	wpVersion?: string;
	fileAccess: SiteFileAccess;
	xdebug: boolean;
	adminUsername: string;
	adminEmail?: string;
}
