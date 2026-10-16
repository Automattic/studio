export interface SiteSettingChanges {
	domainChanged?: boolean;
	httpsChanged?: boolean;
	phpChanged?: boolean;
	wpChanged?: boolean;
	fileAccessChanged?: boolean;
	xdebugChanged?: boolean;
	credentialsChanged?: boolean;
	debugLogChanged?: boolean;
	debugDisplayChanged?: boolean;
	scriptDebugChanged?: boolean;
	environmentTypeChanged?: boolean;
}

export function siteNeedsRestart( changes: SiteSettingChanges ): boolean {
	const {
		domainChanged,
		httpsChanged,
		phpChanged,
		wpChanged,
		fileAccessChanged,
		xdebugChanged,
		credentialsChanged,
		debugLogChanged,
		debugDisplayChanged,
		scriptDebugChanged,
		environmentTypeChanged,
	} = changes;

	return !! (
		domainChanged ||
		httpsChanged ||
		phpChanged ||
		wpChanged ||
		fileAccessChanged ||
		xdebugChanged ||
		credentialsChanged ||
		debugLogChanged ||
		debugDisplayChanged ||
		scriptDebugChanged ||
		environmentTypeChanged
	);
}
