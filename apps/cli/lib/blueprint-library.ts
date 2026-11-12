import fs from 'fs';
import path from 'path';
import {
	createBlueprintTempDir,
	downloadAndExtractBlueprintBundle,
} from '@studio/common/lib/blueprint-bundle';
import { isNetworkError } from '@studio/common/lib/network-utils';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { fetchStudioBlueprints, type Blueprint } from '@studio/common/lib/studio-blueprints-api';
import { BlueprintCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { Logger, LoggerError } from 'cli/logger';

const logger = new Logger< LoggerAction >();

export async function fetchLibraryBlueprints(): Promise< Blueprint[] > {
	logger.reportStart( LoggerAction.FETCH_BLUEPRINTS, __( 'Fetching blueprints…' ) );

	const { locale } = await readSharedConfig();
	const blueprints = await fetchStudioBlueprints( locale ).catch( ( error: unknown ) => {
		if ( isNetworkError( error ) ) {
			throw new LoggerError( __( 'An internet connection is required to use blueprints.' ), error );
		}
		throw error;
	} );

	logger.reportSuccess(
		sprintf(
			_n( 'Found %d blueprint', 'Found %d blueprints', blueprints.length ),
			blueprints.length
		)
	);
	return blueprints;
}

/**
 * Writes a Library Blueprint to a temp directory, extracting its bundle when it has one so
 * resources relative to the Blueprint resolve. The caller removes `tempDir` once done.
 */
export async function prepareLibraryBlueprint( blueprint: Blueprint ): Promise< {
	contents: unknown;
	uri: string;
	tempDir: string;
} > {
	if ( blueprint.bundle_url ) {
		logger.reportStart( LoggerAction.DOWNLOAD_BUNDLE, __( 'Downloading blueprint bundle…' ) );
		const { blueprintJsonPath, tempDir } = await downloadAndExtractBlueprintBundle(
			blueprint.bundle_url
		);
		const contents = JSON.parse( await fs.promises.readFile( blueprintJsonPath, 'utf-8' ) );
		logger.reportSuccess( __( 'Blueprint bundle downloaded' ) );
		return { contents, uri: blueprintJsonPath, tempDir };
	}

	const tempDir = await createBlueprintTempDir();
	const uri = path.join( tempDir, 'blueprint.json' );
	await fs.promises.writeFile( uri, JSON.stringify( blueprint.blueprint ) );
	return { contents: blueprint.blueprint, uri, tempDir };
}
