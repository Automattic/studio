import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { ImportEvents } from 'src/lib/import-export/import/events';
import {
	BackupHandler,
	isFileAllowed,
} from 'src/lib/import-export/import/handlers/backup-handler-factory';
import {
	BackupArchiveInfo,
	BackupExtractProgressEventData,
} from 'src/lib/import-export/import/types';

async function walkDirectory(
	dir: string,
	baseDir: string,
	visited: Set< string > = new Set()
): Promise< string[] > {
	// Resolve to real path to detect circular symlinks
	let realDir;
	try {
		realDir = await fs.promises.realpath( dir );
	} catch {
		return [];
	}
	if ( visited.has( realDir ) ) {
		return [];
	}
	visited.add( realDir );

	const files: string[] = [];
	let entries;
	try {
		entries = await fs.promises.readdir( dir, { withFileTypes: true } );
	} catch {
		return files;
	}
	for ( const entry of entries ) {
		const fullPath = path.join( dir, entry.name );

		if ( entry.isSymbolicLink() ) {
			// Follow symlinks only if they resolve to a directory
			// (used by prepareLocalWPImport to link app/public)
			try {
				const resolved = await fs.promises.realpath( fullPath );
				const stat = await fs.promises.stat( resolved );
				if ( stat.isDirectory() ) {
					files.push( ...( await walkDirectory( fullPath, baseDir, visited ) ) );
				}
			} catch {
				// Skip broken or inaccessible symlinks
			}
			continue;
		}

		if ( entry.isDirectory() ) {
			files.push( ...( await walkDirectory( fullPath, baseDir, visited ) ) );
		} else if ( entry.isFile() ) {
			const relativePath = path.relative( baseDir, fullPath );
			if ( isFileAllowed( relativePath ) ) {
				files.push( relativePath );
			}
		}
	}
	return files;
}

export class BackupHandlerDirectory extends EventEmitter implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		return walkDirectory( backup.path, backup.path );
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		this.emit( ImportEvents.BACKUP_EXTRACT_START );

		try {
			const fileList = await this.listFiles( file );
			const totalFiles = fileList.length;
			let processedFiles = 0;

			for ( const relativePath of fileList ) {
				const sourcePath = path.join( file.path, relativePath );
				const destPath = path.join( extractionDirectory, relativePath );

				// Resolve symlinks to get the real source file
				let realSourcePath;
				try {
					realSourcePath = await fs.promises.realpath( sourcePath );
				} catch {
					continue;
				}

				await fs.promises.mkdir( path.dirname( destPath ), { recursive: true } );

				// Use hardlinks instead of copying to avoid duplicating large files
				// (e.g. wp-content uploads). Falls back to copy if hardlink fails
				// (cross-device or unsupported filesystem).
				try {
					await fs.promises.link( realSourcePath, destPath );
				} catch {
					await fs.promises.copyFile( realSourcePath, destPath );
				}

				processedFiles++;
				this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
					progress: processedFiles / totalFiles,
					processedFiles,
					totalFiles,
					currentFile: relativePath,
				} as BackupExtractProgressEventData );
			}

			this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
		} catch ( error ) {
			this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, { error } );
			throw error;
		}
	}
}
