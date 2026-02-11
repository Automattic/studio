import semver from 'semver';
import { RecommendedPHPVersion as DEFAULT_PHP_VERSION } from '@studio/common/types/php-versions';

/**
 * Compares the WordPress and PHP versions of the current site with the versions supported by Jurassic Ninja preview sites.
 */
export function hasVersionMismatch( {
	wpVersion,
	latestWpVersion,
	phpVersion,
}: {
	wpVersion: string;
	latestWpVersion: string | undefined;
	phpVersion: string;
} ): boolean {
	const coercedWpVersion = semver.coerce( wpVersion );
	const coercedLatestWpVersion = semver.coerce( latestWpVersion );
	const isPhpVersionDefault = phpVersion === DEFAULT_PHP_VERSION;

	// We need coerced versions to ensure they can be parsed and compared by semver
	const isWpVersionOlderThanLatest =
		coercedWpVersion &&
		coercedLatestWpVersion &&
		semver.compare( coercedWpVersion, coercedLatestWpVersion ) < 0;

	return isWpVersionOlderThanLatest || ! isPhpVersionDefault;
}
