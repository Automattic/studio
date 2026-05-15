import { RecommendedPHPVersion as DEFAULT_PHP_VERSION } from '@studio/common/types/php-versions';
import semver from 'semver';

export function hasVersionMismatch(
	version1: string | undefined,
	version2: string | undefined
): boolean {
	const coercedVersion1 = semver.coerce( version1 );
	const coercedVersion2 = semver.coerce( version2 );

	return (
		!! coercedVersion1 &&
		!! coercedVersion2 &&
		semver.compare( coercedVersion1, coercedVersion2 ) !== 0
	);
}

/**
 * Checks if the WordPress and PHP versions of the current site are supported by preview sites.
 * Supported versions are:
 * - WordPress version is the latest stable version
 * - PHP version is the recommended By Studio
 */
export function hasUnsupportedWpOrPhpVersion( {
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
