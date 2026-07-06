// Studio offers the same PHP versions for both runtimes: the versions the
// bundled native PHP binaries are built for. Playground (PHP WASM) supports
// older versions at runtime, which keeps existing sites stored on a
// no-longer-offered version working until they are edited.
export const SupportedPHPVersions = [ '8.5', '8.4', '8.3', '8.2' ] as const;
export const NativePhpSupportedVersions = SupportedPHPVersions;

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

export function getClosestSupportedPhpVersion( version: string ): SupportedPHPVersion | undefined {
	const targetScore = getPhpVersionScore( version );
	if ( targetScore === undefined ) {
		return undefined;
	}

	return SupportedPHPVersions.reduce< SupportedPHPVersion >( ( closest, candidate ) => {
		const closestDistance = Math.abs( getPhpVersionScore( closest )! - targetScore );
		const candidateDistance = Math.abs( getPhpVersionScore( candidate )! - targetScore );
		return candidateDistance < closestDistance ? candidate : closest;
	}, SupportedPHPVersions[ 0 ] );
}

/**
 * The recommended PHP version for new sites.
 * This replaces RecommendedPHPVersion from @wp-playground/common.
 */
export const RecommendedPHPVersion: SupportedPHPVersion = '8.4';
