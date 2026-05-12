import { sprintf } from '@wordpress/i18n';
import semver from 'semver';
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

const phpBinaryManifestSchema = z.record( z.string(), z.unknown() );
const phpBinaryManifestDownloadSchema = z.object( {
	url: z.string().min( 1 ),
	sha: z.string().min( 1 ),
	size: z.number().optional(),
} );
const phpBinaryVersionManifestSchema = z.record(
	z.string(),
	z.record( z.string(), phpBinaryManifestDownloadSchema )
);

export type PhpBinaryDownloadInfo = z.infer< typeof phpBinaryManifestDownloadSchema > & {
	patchVersion: string;
};

export function getEffectivePhpBinaryArch( platform: NodeJS.Platform, arch: string ): string {
	return platform === 'win32' ? 'x64' : arch;
}

export function isPhpPatchVersion( version: string ): boolean {
	return !! semver.valid( version );
}

export function comparePhpPatchVersionsDescending( a: string, b: string ): number {
	return semver.rcompare( a, b );
}

export function isPhpPatchVersionForMinor(
	patchVersion: string,
	version: NativePhpSupportedVersion
): boolean {
	return semver.satisfies( patchVersion, `${ version }.x` );
}

function getManifestDownloadInfoForPatch(
	manifest: Record< string, unknown >,
	patchVersion: string,
	platform: NodeJS.Platform,
	arch: string
): PhpBinaryDownloadInfo | undefined {
	const versionEntry = phpBinaryVersionManifestSchema.safeParse( manifest[ patchVersion ] );
	if ( ! versionEntry.success ) {
		return undefined;
	}

	const downloadInfo =
		versionEntry.data[ platform ]?.[ getEffectivePhpBinaryArch( platform, arch ) ];
	if ( ! downloadInfo ) {
		return undefined;
	}

	return {
		patchVersion,
		...downloadInfo,
	};
}

export function getPhpBinaryManifestDownloadInfo(
	manifest: unknown,
	version: NativePhpSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): PhpBinaryDownloadInfo | undefined {
	const parsedManifest = phpBinaryManifestSchema.safeParse( manifest );
	if ( ! parsedManifest.success ) {
		return undefined;
	}

	const manifestData = parsedManifest.data;
	const patchVersion = Object.keys( manifestData )
		.filter( ( candidate ) => isPhpPatchVersionForMinor( candidate, version ) )
		.sort( comparePhpPatchVersionsDescending )
		.find(
			( candidate ) => !! getManifestDownloadInfoForPatch( manifestData, candidate, platform, arch )
		);
	if ( ! patchVersion ) {
		return undefined;
	}

	return getManifestDownloadInfoForPatch( manifestData, patchVersion, platform, arch );
}
