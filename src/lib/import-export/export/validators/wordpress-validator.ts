import { EventEmitter } from 'events';
import path from 'path';
import { ExportEvents } from '../events';
import { BackupContents, ExportValidator, ExportOptions } from '../types';

export class WordPressExportValidator extends EventEmitter implements ExportValidator {
	canHandle( files: string[] ): boolean {
		const requiredPaths = [ 'wp-content', 'wp-includes', 'wp-load.php', 'wp-config.php' ];

		return requiredPaths.every( ( requiredPath ) =>
			files.some( ( file ) => file.includes( requiredPath ) )
		);
	}

	filterFiles( files: string[], options: ExportOptions ): BackupContents {
		this.emit( ExportEvents.EXPORT_VALIDATION_START );
		const backupContents: BackupContents = {
			backupFile: options.backupFile,
			sqlFiles: [],
			wpContent: {
				uploads: [],
				plugins: [],
				themes: [],
			},
		};

		files.forEach( ( file ) => {
			const relativePath = path.relative( options.sitePath, file );
			if ( path.basename( file ) === 'wp-config.php' ) {
				backupContents.wpConfigFile = file;
			} else if ( relativePath.startsWith( 'wp-content/uploads/' ) && options.includes.uploads ) {
				backupContents.wpContent.uploads.push( file );
			} else if ( relativePath.startsWith( 'wp-content/plugins/' ) && options.includes.plugins ) {
				backupContents.wpContent.plugins.push( file );
			} else if ( relativePath.startsWith( 'wp-content/themes/' ) && options.includes.themes ) {
				backupContents.wpContent.themes.push( file );
			}
		} );

		this.emit( ExportEvents.EXPORT_VALIDATION_COMPLETE );
		return backupContents;
	}
}
