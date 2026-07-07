export interface SiteSettingChanges {
	domainChanged?: boolean;
	httpsChanged?: boolean;
	phpChanged?: boolean;
	wpChanged?: boolean;
	runtimeChanged?: boolean;
	fileAccessChanged?: boolean;
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
		runtimeChanged,
		fileAccessChanged,
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
		runtimeChanged ||
		fileAccessChanged ||
		xdebugChanged ||
		credentialsChanged ||
		debugLogChanged ||
		debugDisplayChanged
	);
}
