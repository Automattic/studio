import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ARCHIVER_OPTIONS } from '@studio/common/constants';
import { createExportErrorPayload, ExportEvents } from '@studio/common/lib/import-export-events';
import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import { __ } from '@wordpress/i18n';
import { ZipArchive } from 'archiver';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import { runPhpCommand } from 'cli/lib/native-php/php-process';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { ImportExportEventEmitter } from '../../events';
import { DefaultExporter } from './default-exporter';
import type { Exporter, ExportOptions } from '../types';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

class SnapshotExporter extends DefaultExporter {
	constructor(
		options: ExportOptions,
		private readonly tempDir: string,
		private readonly tablePrefix: string
	) {
		super( options );
	}

	protected addWpConfig(): void {
		// Keep the table prefix without distributing the source site's credentials or paths.
		const sample = fs.readFileSync(
			path.join( this.options.site.path, 'wp-config-sample.php' ),
			'utf8'
		);
		this.archiveBuilder.append(
			sample.replace( /(\$table_prefix\s*=\s*)'[^']*'/, `$1'${ this.tablePrefix }'` ),
			{ name: 'wp-config.php' }
		);
	}

	protected async addMetadata(): Promise< void > {}

	protected async addDatabase(): Promise< void > {
		this.emit( ExportEvents.DATABASE_EXPORT_START );
		const snapshot = path.join( this.tempDir, '.ht.sqlite' );
		await runPhpCommand(
			[
				'-r',
				`$database = new PDO('sqlite:' . $argv[1], null, null, [
				PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
				PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY,
			]);
			$database->exec('PRAGMA busy_timeout = 5000');
			$database->exec('VACUUM INTO ' . $database->quote($argv[2]));`,
				path.join( this.options.site.path, 'wp-content/database/.ht.sqlite' ),
				snapshot,
			],
			{ phpVersion: resolveSupportedPhpVersion( this.options.phpVersion ) }
		);
		this.archiveBuilder.file( snapshot, { name: 'wp-content/database/.ht.sqlite' } );
		this.emit( ExportEvents.DATABASE_EXPORT_COMPLETE );
	}
}

export class BlueprintExporter extends ImportExportEventEmitter implements Exporter {
	constructor( private readonly options: ExportOptions ) {
		super();
	}

	async canHandle(): Promise< boolean > {
		return this.options.backupFile.toLowerCase().endsWith( '.zip' );
	}

	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		const tempDir = await fs.promises.mkdtemp(
			path.join( os.tmpdir(), 'studio-blueprint-export-' )
		);
		const stagedOutput = path.join(
			path.dirname( this.options.backupFile ),
			`.${ path.basename( this.options.backupFile ) }.${ randomUUID() }.tmp`
		);
		try {
			await using command = await runWpCliCommand( this.options.site, [
				'eval',
				'echo json_encode( array( "tablePrefix" => $GLOBALS["table_prefix"], "multisite" => is_multisite() ) );',
				'--skip-plugins',
				'--skip-themes',
			] );
			const [ exitCode, stdout, stderr ] = await Promise.all( [
				command.response.exitCode,
				command.response.stdoutText,
				command.response.stderrText,
			] );
			const settings = exitCode === 0 ? parseJsonFromPhpOutput( stdout ) : null;
			const tablePrefix = settings?.tablePrefix;
			if ( settings?.multisite )
				throw new Error( __( 'Exporting multisite networks as Blueprints is not supported yet.' ) );
			if (
				exitCode !== 0 ||
				typeof tablePrefix !== 'string' ||
				! /^[a-zA-Z0-9_]+$/.test( tablePrefix )
			) {
				throw new Error( stderr || __( 'Could not read the site database prefix.' ) );
			}
			const snapshotPath = path.join( tempDir, 'site.zip' );
			const snapshot = new SnapshotExporter(
				{ ...this.options, backupFile: snapshotPath },
				tempDir,
				tablePrefix
			);
			for ( const event of Object.values( ExportEvents ) ) {
				if (
					event !== ExportEvents.EXPORT_START &&
					event !== ExportEvents.EXPORT_COMPLETE &&
					event !== ExportEvents.EXPORT_ERROR
				) {
					snapshot.on( event, ( data ) => this.emit( event, data ) );
				}
			}
			await snapshot.export();
			const wpVersion = await getWordPressVersionFromInstallation( this.options.site.path );
			const blueprint: BlueprintV1Declaration = {
				meta: { title: this.options.site.name, author: 'WordPress Studio' },
				preferredVersions: {
					php: this.options.phpVersion as NonNullable<
						BlueprintV1Declaration[ 'preferredVersions' ]
					>[ 'php' ],
					wp: wpVersion || 'latest',
				},
				landingPage: '/',
				steps: [
					{
						step: 'importWordPressFiles',
						wordPressFilesZip: { resource: 'bundled', path: 'site.zip' },
					},
				],
			};
			const archive = new ZipArchive( ARCHIVER_OPTIONS.zip );
			archive.append( JSON.stringify( blueprint, null, 2 ), { name: 'blueprint.json' } );
			archive.file( snapshotPath, { name: 'site.zip' } );
			await Promise.all( [
				pipeline( archive, fs.createWriteStream( stagedOutput ) ),
				archive.finalize(),
			] );
			await fs.promises.rename( stagedOutput, this.options.backupFile );
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.emit( ExportEvents.EXPORT_ERROR, createExportErrorPayload( error ) );
			throw error;
		} finally {
			await fs.promises.rm( stagedOutput, { force: true } );
			await fs.promises.rm( tempDir, { recursive: true, force: true } );
		}
	}
}
