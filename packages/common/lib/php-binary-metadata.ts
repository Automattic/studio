import { sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import {
	getClosestSupportedPhpVersion,
	LatestNativePhpSupportedVersion,
	NativePhpSupportedVersions,
	type NativePhpSupportedVersion,
} from '../types/php-versions.ts';
import phpBinaryCdnMetadataModule from './php-binary-cdn-metadata.mjs';

export { NativePhpSupportedVersions, type NativePhpSupportedVersion };

const nativePhpVersionSchema = z.enum( NativePhpSupportedVersions );
export const MinimumNativePhpSupportedVersion =
	NativePhpSupportedVersions[ NativePhpSupportedVersions.length - 1 ];

export function validateNativePhpVersion( version: string ): NativePhpSupportedVersion {
	const result = nativePhpVersionSchema.safeParse( version );
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

export function resolveNativePhpVersion( version: string ): NativePhpSupportedVersion {
	const result = nativePhpVersionSchema.safeParse( version );
	if ( result.success ) {
		return result.data;
	}

	if ( ! version ) {
		return LatestNativePhpSupportedVersion;
	}

	const resolvedVersion = getClosestSupportedPhpVersion( version );
	return resolvedVersion ?? validateNativePhpVersion( version );
}

const phpBinaryArtifactSchema = z.object( {
	url: z.string().min( 1 ),
	sha: z.string().min( 1 ),
} );

const phpBinaryCdnMetadataSchema = z.object( {
	versions: z.record(
		z.string(),
		z.object( {
			version: z.string().regex( /^\d+\.\d+\.\d+$/ ),
			artifacts: z.record( z.string(), phpBinaryArtifactSchema ),
		} )
	),
} );

const phpBinaryCdnMetadata = phpBinaryCdnMetadataSchema.parse( phpBinaryCdnMetadataModule );

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
