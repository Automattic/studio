import { sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';

export const PHP_BINARY_MANIFEST_URL =
	'https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/releases.json';

// PHP versions supported by the native-php runtime (subset of SupportedPHPVersions).
// PHP 7.4 is excluded: Studio does not publish native PHP 7.4 binaries.
export const NativePhpSupportedVersions = SupportedPHPVersions.filter( ( v ) => v !== '7.4' );
export type NativePhpSupportedVersion = ( typeof NativePhpSupportedVersions )[ number ];

export function validateNativePhpVersion( version: string ): NativePhpSupportedVersion {
	const phpVersionSchema = z.enum( NativePhpSupportedVersions );
	const result = phpVersionSchema.safeParse( version );
	if ( ! result.success ) {
		throw new Error(
			sprintf(
				`PHP %s is not supported by the native-php runtime. Supported versions: %s.`,
				version,
				NativePhpSupportedVersions.join( ', ' )
			)
		);
	}
	return result.data;
}

export type PhpBinaryDownloadInfo = {
	patchVersion: string;
	url: string;
	sha: string;
	size?: number;
};

function isRecord( value: unknown ): value is Record< string, unknown > {
	return typeof value === 'object' && value !== null && ! Array.isArray( value );
}

export function getEffectivePhpBinaryArch( platform: NodeJS.Platform, arch: string ): string {
	return platform === 'win32' ? 'x64' : arch;
}

export function parsePhpPatchVersion( version: string ): [ number, number, number ] | undefined {
	const parts = version.split( '.' );
	if ( parts.length !== 3 || parts.some( ( part ) => ! /^\d+$/.test( part ) ) ) {
		return undefined;
	}
	return parts.map( Number ) as [ number, number, number ];
}

export function comparePhpPatchVersionsDescending( a: string, b: string ): number {
	const parsedA = parsePhpPatchVersion( a );
	const parsedB = parsePhpPatchVersion( b );
	if ( ! parsedA || ! parsedB ) {
		return 0;
	}
	return parsedB[ 0 ] - parsedA[ 0 ] || parsedB[ 1 ] - parsedA[ 1 ] || parsedB[ 2 ] - parsedA[ 2 ];
}

export function isPhpPatchVersionForMinor(
	patchVersion: string,
	version: NativePhpSupportedVersion
): boolean {
	const parsedPatchVersion = parsePhpPatchVersion( patchVersion );
	const [ major, minor ] = version.split( '.' ).map( Number );
	return (
		!! parsedPatchVersion && parsedPatchVersion[ 0 ] === major && parsedPatchVersion[ 1 ] === minor
	);
}

function getManifestDownloadInfoForPatch(
	manifest: Record< string, unknown >,
	patchVersion: string,
	platform: NodeJS.Platform,
	arch: string
): PhpBinaryDownloadInfo | undefined {
	const versionEntry = manifest[ patchVersion ];
	if ( ! isRecord( versionEntry ) ) {
		return undefined;
	}

	const platformEntry = versionEntry[ platform ];
	if ( ! isRecord( platformEntry ) ) {
		return undefined;
	}

	const downloadInfo = platformEntry[ getEffectivePhpBinaryArch( platform, arch ) ];
	if ( ! isRecord( downloadInfo ) ) {
		return undefined;
	}

	const url = downloadInfo.url;
	const sha = downloadInfo.sha;
	if ( typeof url !== 'string' || ! url || typeof sha !== 'string' || ! sha ) {
		return undefined;
	}

	return {
		patchVersion,
		url,
		sha,
		size: typeof downloadInfo.size === 'number' ? downloadInfo.size : undefined,
	};
}

export function getPhpBinaryManifestDownloadInfo(
	manifest: unknown,
	version: NativePhpSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): PhpBinaryDownloadInfo | undefined {
	if ( ! isRecord( manifest ) ) {
		return undefined;
	}

	const patchVersion = Object.keys( manifest )
		.filter( ( candidate ) => isPhpPatchVersionForMinor( candidate, version ) )
		.sort( comparePhpPatchVersionsDescending )
		.find(
			( candidate ) => !! getManifestDownloadInfoForPatch( manifest, candidate, platform, arch )
		);
	if ( ! patchVersion ) {
		return undefined;
	}

	return getManifestDownloadInfoForPatch( manifest, patchVersion, platform, arch );
}
