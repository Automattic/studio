import { SITE_RUNTIME_NATIVE_PHP, type SiteRuntime } from '../lib/site-runtime';

export const SupportedPHPVersions = [ '8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4' ] as const;
export const NativePhpSupportedVersions = [ '8.5', '8.4', '8.3', '8.2' ] as const;

export const LatestSupportedPHPVersion = '8.5' as const;
export const LatestNativePhpSupportedVersion = NativePhpSupportedVersions[ 0 ];

/**
 * We don't have an opportunity to retrieve PHP version from Jetpack connected sites,
 * so as a temporary solution - we are using a hardcoded value.
 */
export const PressablePHPVersion = '8.5' as const;

export const SupportedPHPVersionsList: string[] = [ ...SupportedPHPVersions ];

export type SupportedPHPVersion = ( typeof SupportedPHPVersions )[ number ];
export type NativePhpSupportedVersion = ( typeof NativePhpSupportedVersions )[ number ];

function getPhpVersionScore( version: string ): number | undefined {
	const match = version.match( /^(\d+)\.(\d+)$/ );
	if ( ! match ) {
		return undefined;
	}

	return Number( match[ 1 ] ) * 100 + Number( match[ 2 ] );
}

export function isSupportedPHPVersion(
	version: string | undefined
): version is SupportedPHPVersion {
	return SupportedPHPVersions.includes( version as SupportedPHPVersion );
}

export function getSupportedPHPVersionsForRuntime(
	runtime: SiteRuntime
): readonly SupportedPHPVersion[] {
	return runtime === SITE_RUNTIME_NATIVE_PHP ? NativePhpSupportedVersions : SupportedPHPVersions;
}

export function getClosestNativePhpVersion(
	version: string
): NativePhpSupportedVersion | undefined {
	const targetScore = getPhpVersionScore( version );
	if ( targetScore === undefined ) {
		return undefined;
	}

	return NativePhpSupportedVersions.reduce< NativePhpSupportedVersion >( ( closest, candidate ) => {
		const closestDistance = Math.abs( getPhpVersionScore( closest )! - targetScore );
		const candidateDistance = Math.abs( getPhpVersionScore( candidate )! - targetScore );
		return candidateDistance < closestDistance ? candidate : closest;
	}, NativePhpSupportedVersions[ 0 ] );
}

/**
 * The recommended PHP version for new sites.
 * This replaces RecommendedPHPVersion from @wp-playground/common.
 */
export const RecommendedPHPVersion: SupportedPHPVersion = '8.4';

export function getRecommendedPHPVersionForRuntime( runtime: SiteRuntime ): SupportedPHPVersion {
	const supportedVersions = getSupportedPHPVersionsForRuntime( runtime );
	return supportedVersions.includes( RecommendedPHPVersion )
		? RecommendedPHPVersion
		: supportedVersions[ 0 ] ?? RecommendedPHPVersion;
}
