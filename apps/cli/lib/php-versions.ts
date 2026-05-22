import { SITE_RUNTIME_NATIVE_PHP, type SiteRuntime } from '@studio/common/lib/site-runtime';
import {
	getRecommendedPHPVersionForRuntime,
	getSupportedPHPVersionsForRuntime,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteRuntime } from 'cli/lib/feature-flags';
import { LoggerError } from 'cli/logger';

export function getSupportedPhpVersionsForSiteRuntime(
	runtime: SiteRuntime = getSiteRuntime()
): readonly SupportedPHPVersion[] {
	return getSupportedPHPVersionsForRuntime( runtime );
}

export function getRecommendedPhpVersionForSiteRuntime(
	runtime: SiteRuntime = getSiteRuntime()
): SupportedPHPVersion {
	return getRecommendedPHPVersionForRuntime( runtime );
}

export function validatePhpVersionForSiteRuntime(
	version: string,
	runtime: SiteRuntime = getSiteRuntime()
): SupportedPHPVersion {
	const supportedVersions = getSupportedPhpVersionsForSiteRuntime( runtime );
	if ( supportedVersions.includes( version as SupportedPHPVersion ) ) {
		return version as SupportedPHPVersion;
	}

	const runtimeLabel =
		runtime === SITE_RUNTIME_NATIVE_PHP ? __( 'native PHP' ) : __( 'Playground' );
	throw new LoggerError(
		sprintf(
			__( 'PHP %1$s is not supported by the %2$s runtime. Supported versions: %3$s.' ),
			version,
			runtimeLabel,
			supportedVersions.join( ', ' )
		)
	);
}
