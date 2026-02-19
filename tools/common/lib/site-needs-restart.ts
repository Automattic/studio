export interface SiteSettingChanges {
	domainChanged?: boolean;
	httpsChanged?: boolean;
	phpChanged?: boolean;
	wpChanged?: boolean;
	xdebugChanged?: boolean;
	credentialsChanged?: boolean;
}

export function siteNeedsRestart( changes: SiteSettingChanges ): boolean {
	const { domainChanged, httpsChanged, phpChanged, wpChanged, xdebugChanged, credentialsChanged } =
		changes;

	return !! (
		domainChanged ||
		httpsChanged ||
		phpChanged ||
		wpChanged ||
		xdebugChanged ||
		credentialsChanged
	);
}
