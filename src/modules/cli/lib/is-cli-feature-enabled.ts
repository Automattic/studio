import { app } from 'electron';
import { prerelease } from 'semver';

// The Studio CLI is available in development, and in prerelease builds (dev and beta builds).
export function isCLIFeatureEnabled() {
	return process.env.NODE_ENV === 'development' || prerelease( app.getVersion() );
}
