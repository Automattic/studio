import { sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { SupportedPHPVersions } from '@studio/common/types/php-versions';
import phpBinaryCdnMetadataJson from './php-binary-cdn-metadata.json';

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

const phpBinaryArtifactSchema = z.object( {
	url: z.string().min( 1 ),
	sha: z.string().min( 1 ),
} );

const phpBinaryCdnMetadataSchema = z.object( {
	versions: z.partialRecord(
		z.enum( NativePhpSupportedVersions ),
		z.object( {
			version: z.string().regex( /^\d+\.\d+\.\d+$/ ),
			artifacts: z.record( z.string(), phpBinaryArtifactSchema ),
		} )
	),
} );

const phpBinaryCdnMetadata = phpBinaryCdnMetadataSchema.parse( phpBinaryCdnMetadataJson );

export type PhpBinaryDownloadInfo = z.infer< typeof phpBinaryArtifactSchema > & {
	patchVersion: string;
};

export function getEffectivePhpBinaryArch( platform: NodeJS.Platform, arch: string ): string {
	return platform === 'win32' ? 'x64' : arch;
}

export function getConfiguredPhpBinaryVersion(
	version: NativePhpSupportedVersion
): string | undefined {
	return version in phpBinaryCdnMetadata.versions
		? phpBinaryCdnMetadata.versions[ version ]?.version
		: undefined;
}

export function getPhpBinaryDownloadInfo(
	version: NativePhpSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): PhpBinaryDownloadInfo | undefined {
	const versionMetadata = phpBinaryCdnMetadata.versions[ version ];
	if ( ! versionMetadata ) {
		return undefined;
	}

	const artifactKey = `${ platform }-${ getEffectivePhpBinaryArch( platform, arch ) }`;
	const artifact = versionMetadata.artifacts[ artifactKey ];
	if ( ! artifact ) {
		return undefined;
	}

	return {
		patchVersion: versionMetadata.version,
		url: artifact.url,
		sha: artifact.sha,
	};
}
