import semver from 'semver';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

interface VersionComparisonResult {
	phpVersionMismatch: boolean;
	wpVersionMismatch: boolean;
}

export function compareVersions( {
	wpVersion,
	latestWpVersion,
	phpVersion,
}: {
	wpVersion: string;
	latestWpVersion: string | undefined;
	phpVersion: string;
} ): VersionComparisonResult {
	const coercedWpVersion = semver.coerce( wpVersion );
	const coercedLatestWpVersion = semver.coerce( latestWpVersion );
	const isPhpVersionDefault = phpVersion === DEFAULT_PHP_VERSION;

	// We need coerced versions to ensure they can be parsed and compared by semver
	const isWpVersionOlderThanLatest =
		coercedWpVersion &&
		coercedLatestWpVersion &&
		semver.compare( coercedWpVersion, coercedLatestWpVersion ) < 0;

	return {
		phpVersionMismatch: ! isPhpVersionDefault,
		wpVersionMismatch: !! isWpVersionOlderThanLatest,
	};
}
