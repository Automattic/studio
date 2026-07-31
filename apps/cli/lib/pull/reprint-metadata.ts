import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { runReprintCommandUntilComplete } from 'cli/lib/pull/migration-client';

export interface ReprintImportMetadata {
	hasCompletedOnce: boolean;
	hasLocalIndex: boolean;
	hasSkippedFiles: boolean;
	pullStage: unknown;
	sourceSite: {
		homeUrl: string | null;
		siteUrl: string | null;
		tablePrefix: string | null;
		wordpressDatabaseCharset: string | null;
		serverDatabaseCharset: string | null;
		contentDirectory: string | null;
		wordpressAbsolutePath: string | null;
		wordpressRoots: string[];
		extraDirectories: string[];
	};
}

/**
 * Reads Reprint-owned import state through its public metadata command.
 */
export async function readReprintImportMetadata(
	stateDirectory: string,
	rawDirectory: string
): Promise< ReprintImportMetadata > {
	const result = await runReprintCommandUntilComplete(
		stateDirectory,
		rawDirectory,
		[ 'import-metadata', `--state-dir=${ stateDirectory }` ],
		undefined,
		{ runtime: SITE_RUNTIME_NATIVE_PHP }
	);

	return JSON.parse( result.stdout ) as ReprintImportMetadata;
}
