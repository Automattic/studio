import { __ } from '@wordpress/i18n';
import type { SiteDetails } from '@/data/core';

export function getPhpMyAdminUnavailableReason( site: SiteDetails ) {
	return site.phpMyAdminSupported === false
		? __(
				'Studio’s phpMyAdmin supports SQLite only. Use a separate database client for external MySQL.'
		  )
		: undefined;
}
