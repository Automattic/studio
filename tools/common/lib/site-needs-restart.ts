export interface SiteSettingChanges {
	domainChanged?: boolean;
	httpsChanged?: boolean;
	phpChanged?: boolean;
	wpChanged?: boolean;
	xdebugChanged?: boolean;
	credentialsChanged?: boolean;
	debugLogChanged?: boolean;
	debugDisplayChanged?: boolean;
	phpmyadminChanged?: boolean;
}

export function siteNeedsRestart( changes: SiteSettingChanges ): boolean {
	const {
		domainChanged,
		httpsChanged,
		phpChanged,
		wpChanged,
		xdebugChanged,
		credentialsChanged,
		debugLogChanged,
		debugDisplayChanged,
		phpmyadminChanged,
	} = changes;

	return !! (
		domainChanged ||
		httpsChanged ||
		phpChanged ||
		wpChanged ||
		xdebugChanged ||
		credentialsChanged ||
		debugLogChanged ||
		debugDisplayChanged ||
		phpmyadminChanged
	);
}
