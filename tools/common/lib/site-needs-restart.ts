export interface SiteSettingChanges {
	domainChanged?: boolean;
	httpsChanged?: boolean;
	phpChanged?: boolean;
	wpChanged?: boolean;
	xdebugChanged?: boolean;
	credentialsChanged?: boolean;
	debugLogChanged?: boolean;
	debugDisplayChanged?: boolean;
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
	} = changes;

	return !! (
		domainChanged ||
		httpsChanged ||
		phpChanged ||
		wpChanged ||
		xdebugChanged ||
		credentialsChanged ||
		debugLogChanged ||
		debugDisplayChanged
	);
}
