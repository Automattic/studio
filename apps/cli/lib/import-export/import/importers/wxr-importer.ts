import fs from 'fs';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { ImportEvents } from '@studio/common/lib/import-export-events';
import { __, sprintf } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import {
	getBundledWordPressImporterPath,
	getBundledWxrImportScriptPath,
} from 'cli/lib/dependency-management/paths';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { ImportExportEventEmitter } from '../../events';
import { BackupContents } from '../types';
import { updateSiteUrl } from '../update-site-url';
import { ensureDir, Importer, ImporterResult } from './importer';

// Files staged into the site for the import are placed under this directory (at the
// site root) so they don't collide with real site content and are easy to clean up.
const IMPORT_STAGING_SUBDIR = '.studio-wxr-import';

// The wordpress-importer plugin ships in the CLI bundle (downloaded at build time, see
// `getBundledWordPressImporterPath`) and is installed here so the WXR import works offline
// (no wordpress.org fetch). It is loaded directly by the PHP driver, so no `wp plugin
// activate` step is required.
const WORDPRESS_IMPORTER_PLUGIN_SLUG = 'wordpress-importer';

// WordPress export (WXR) importer. Unlike the full-site backup importers it does not
// replace wp-content or the database — it merges the exported content (posts, pages,
// terms, authors, media) into the existing install via the wordpress-importer plugin,
// mirroring the WordPress dashboard's Tools → Import → WordPress flow.
export class WxrImporter extends ImportExportEventEmitter implements Importer {
	constructor( protected backup: BackupContents ) {
		super();
	}

	async import( site: SiteData ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START, 'xml' );

		const wxrFile = this.backup.wxrFiles?.[ 0 ];
		if ( ! wxrFile ) {
			const error = new Error( __( 'No WordPress export (.xml) file found to import.' ) );
			this.emit( ImportEvents.IMPORT_ERROR, error.message );
			throw error;
		}

		const stagingDir = path.join( site.path, IMPORT_STAGING_SUBDIR );
		const stagedWxrName = 'import.xml';
		const stagedScriptName = 'import-wxr.php';

		try {
			await this.ensureWordPressImporterPlugin( site );

			// Studio's wp-cli can't `eval-file` arbitrary host paths — the file must live
			// inside the site VFS (mounted at /wordpress). Stage the WXR and the driver
			// script under the site root and reference them with paths relative to it.
			await ensureDir( stagingDir );
			await fs.promises.copyFile( wxrFile, path.join( stagingDir, stagedWxrName ) );
			await fs.promises.copyFile(
				getBundledWxrImportScriptPath(),
				path.join( stagingDir, stagedScriptName )
			);

			const scriptRelPath = `${ IMPORT_STAGING_SUBDIR }/${ stagedScriptName }`;
			const wxrRelPath = `${ IMPORT_STAGING_SUBDIR }/${ stagedWxrName }`;

			this.emit( ImportEvents.IMPORT_DATABASE_START );

			await using command = await runWpCliCommand(
				site,
				[
					`--skip-plugins=${ WORDPRESS_IMPORTER_PLUGIN_SLUG }`,
					'eval-file',
					scriptRelPath,
					wxrRelPath,
				],
				{ phpVersion: DEFAULT_PHP_VERSION }
			);

			const exitCode = await command.response.exitCode;
			const stderr = await command.response.stderrText;

			if ( stderr ) {
				console.error( __( 'Error during WordPress export import:' ), stderr );
			}
			if ( exitCode !== 0 ) {
				throw new Error( sprintf( __( 'WordPress export import failed: %s' ), stderr ) );
			}

			this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );

			await updateSiteUrl( site );

			this.emit( ImportEvents.IMPORT_COMPLETE, 'xml' );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpConfig: this.backup.wpConfig,
				wpContentFiles: this.backup.wpContentFiles,
				wpContentDirectory: this.backup.wpContentDirectory,
			};
		} catch ( error ) {
			this.emit(
				ImportEvents.IMPORT_ERROR,
				error instanceof Error ? error.message : String( error )
			);
			throw error;
		} finally {
			await fs.promises.rm( stagingDir, { recursive: true, force: true } ).catch( () => undefined );
		}
	}

	// Install the vendored wordpress-importer plugin into the site's plugins directory
	// so it's available offline. Overwrites any existing copy to keep it up to date.
	protected async ensureWordPressImporterPlugin( site: SiteData ): Promise< void > {
		const pluginsDir = path.join( site.path, 'wp-content', 'plugins' );
		const destDir = path.join( pluginsDir, WORDPRESS_IMPORTER_PLUGIN_SLUG );
		await ensureDir( pluginsDir );
		await fs.promises.rm( destDir, { recursive: true, force: true } );
		await fs.promises.cp( getBundledWordPressImporterPath(), destDir, { recursive: true } );
	}
}
