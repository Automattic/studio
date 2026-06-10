export function getNavigatorPlatform(): string {
	if ( typeof navigator === 'undefined' ) {
		return 'MacIntel';
	}
	return navigator.platform || navigator.userAgent;
}

export function isMacPlatform( platform = getNavigatorPlatform() ): boolean {
	return /mac/i.test( platform );
}
