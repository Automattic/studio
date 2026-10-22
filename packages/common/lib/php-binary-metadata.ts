import { sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import {
	getClosestSupportedPhpVersion,
	isSupportedPHPVersion,
	LatestSupportedPHPVersion,
	SupportedPHPVersions,
	type SupportedPHPVersion,
} from '../types/php-versions.ts';
import phpBinaryCdnMetadataModule from './php-binary-cdn-metadata.mjs';

// Maps a stored or requested PHP version to one Studio ships: older versions run with the closest
// supported one, and an empty version means the latest.
export function resolveSupportedPhpVersion( version: string ): SupportedPHPVersion {
	if ( isSupportedPHPVersion( version ) ) {
		return version;
	}

	if ( ! version ) {
		return LatestSupportedPHPVersion;
	}

	const resolvedVersion = getClosestSupportedPhpVersion( version );
	if ( ! resolvedVersion ) {
		throw new Error(
			sprintf(
				`PHP %s is not supported. Supported versions: %s.`,
				version,
				SupportedPHPVersions.join( ', ' )
			)
		);
	}
	return resolvedVersion;
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
			packageVersion: z
				.string()
				.regex( /^[a-z0-9][a-z0-9._-]{0,63}$/ )
				.optional(),
			artifacts: z.record( z.string(), phpBinaryArtifactSchema ),
		} )
	),
} );

const phpBinaryCdnMetadata = phpBinaryCdnMetadataSchema.parse( phpBinaryCdnMetadataModule );

export type PhpBinaryDownloadInfo = z.infer< typeof phpBinaryArtifactSchema > & {
	patchVersion: string;
	packageVersion?: string;
	packageId: string;
};

export function getEffectivePhpBinaryArch( platform: NodeJS.Platform, arch: string ): string {
	return platform === 'win32' ? 'x64' : arch;
}

export function getConfiguredPhpBinaryVersion( version: SupportedPHPVersion ): string | undefined {
	return version in phpBinaryCdnMetadata.versions
		? phpBinaryCdnMetadata.versions[ version ]?.version
		: undefined;
}

export function getConfiguredPhpBinaryPackageVersion(
	version: SupportedPHPVersion
): string | undefined {
	return phpBinaryCdnMetadata.versions[ version ]?.packageVersion;
}

export function getConfiguredPhpBinaryPackageId(
	version: SupportedPHPVersion
): string | undefined {
	const versionMetadata = phpBinaryCdnMetadata.versions[ version ];
	if ( ! versionMetadata ) {
		return undefined;
	}
	return versionMetadata.packageVersion
		? `${ versionMetadata.version }-${ versionMetadata.packageVersion }`
		: versionMetadata.version;
}

export function getPhpBinaryDownloadInfo(
	version: SupportedPHPVersion,
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
		packageVersion: versionMetadata.packageVersion,
		packageId: versionMetadata.packageVersion
			? `${ versionMetadata.version }-${ versionMetadata.packageVersion }`
			: versionMetadata.version,
		url: artifact.url,
		sha: artifact.sha,
	};
}
