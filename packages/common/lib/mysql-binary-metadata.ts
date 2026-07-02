import { z } from 'zod';
import mysqlBinaryCdnMetadataJson from './mysql-binary-cdn-metadata.json';

export const DefaultMysqlSupportedVersion = '8.4' as const;
export const MysqlSupportedVersions = [ DefaultMysqlSupportedVersion ] as const;
export type MysqlSupportedVersion = ( typeof MysqlSupportedVersions )[ number ];

const mysqlVersionSchema = z.enum( MysqlSupportedVersions );

const mysqlBinaryArtifactSchema = z.object( {
	url: z.string().min( 1 ),
	sha: z.string().regex( /^[a-f0-9]{64}$/ ),
	archiveType: z.enum( [ 'zip', 'tar.gz' ] ),
	rootDir: z.string().min( 1 ),
} );

const mysqlBinaryCdnMetadataSchema = z.object( {
	versions: z.record(
		z.string(),
		z.object( {
			version: z.string().regex( /^\d+\.\d+\.\d+$/ ),
			artifacts: z.record( z.string(), mysqlBinaryArtifactSchema ),
		} )
	),
} );

const mysqlBinaryCdnMetadata = mysqlBinaryCdnMetadataSchema.parse( mysqlBinaryCdnMetadataJson );

export type MysqlBinaryDownloadInfo = z.infer< typeof mysqlBinaryArtifactSchema > & {
	patchVersion: string;
};

export function validateMysqlSupportedVersion( version: string ): MysqlSupportedVersion {
	return mysqlVersionSchema.parse( version );
}

export function getConfiguredMysqlBinaryVersion(
	version: MysqlSupportedVersion = DefaultMysqlSupportedVersion
): string | undefined {
	return mysqlBinaryCdnMetadata.versions[ version ]?.version;
}

export function getEffectiveMysqlBinaryArch( platform: NodeJS.Platform, arch: string ): string {
	// MySQL does not publish Windows ARM64 community server archives. Keep the same
	// x64-under-emulation shape as native PHP once Windows metadata is added.
	return platform === 'win32' ? 'x64' : arch;
}

export function getMysqlBinaryDownloadInfo(
	version: MysqlSupportedVersion,
	platform: NodeJS.Platform,
	arch: string
): MysqlBinaryDownloadInfo | undefined {
	const versionMetadata = mysqlBinaryCdnMetadata.versions[ version ];
	if ( ! versionMetadata ) {
		return undefined;
	}

	const artifactKey = `${ platform }-${ getEffectiveMysqlBinaryArch( platform, arch ) }`;
	const artifact = versionMetadata.artifacts[ artifactKey ];
	if ( ! artifact ) {
		return undefined;
	}

	return {
		patchVersion: versionMetadata.version,
		...artifact,
	};
}
