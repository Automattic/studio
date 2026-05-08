import { __, _n, sprintf } from '@wordpress/i18n';
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

// Pinned patch versions per PHP minor. Bump when publishing new PHP CLI binaries.
export const PHP_PATCH_VERSIONS: Record< NativePhpSupportedVersion, string > = {
	'8.5': '8.5.5',
	'8.4': '8.4.20',
	'8.3': '8.3.30',
	'8.2': '8.2.30',
	'8.1': '8.1.34',
	'8.0': '8.0.30',
};

export type PhpBinaryDownloadInfo = {
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

export function getPhpBinaryManifestDownloadInfo(
	manifest: unknown,
	version: NativePhpSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): PhpBinaryDownloadInfo | undefined {
	if ( ! isRecord( manifest ) ) {
		return undefined;
	}

	const versionEntry = manifest[ PHP_PATCH_VERSIONS[ version ] ];
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
		url,
		sha,
		size: typeof downloadInfo.size === 'number' ? downloadInfo.size : undefined,
	};
}
