import { EventEmitter } from 'events';
import { BackupHandlerSql } from 'src/lib/import-export/import/handlers/backup-handler-sql';
import { BackupHandlerTarGz } from 'src/lib/import-export/import/handlers/backup-handler-tar-gz';
import { BackupHandlerWpress } from 'src/lib/import-export/import/handlers/backup-handler-wpress';
import { BackupHandlerZip } from 'src/lib/import-export/import/handlers/backup-handler-zip';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
export interface BackupHandler extends Partial< EventEmitter > {
	listFiles( file: BackupArchiveInfo ): Promise< string[] >;
	extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void >;
}

const EXCLUDED_FILES_PATTERNS = [
	/^__MACOSX\/.*/, // MacOS meta folder
	/^\..*/, // Unix hidden files at root
	/\/\.(?!.*\.sqlite$).*/, // Unix hidden files at subfolders, except .sqlite files
];

export function isFileAllowed( filePath: string ) {
	return EXCLUDED_FILES_PATTERNS.every( ( pattern ) => ! pattern.test( filePath ) );
}

export class BackupHandlerFactory {
	private static zipTypes = [
		'application/zip',
		'application/x-zip',
		'application/x-zip-compressed',
		'application/octet-stream',
	];
	private static zipExtensions = [ '.zip' ];

	private static tarGzTypes = [
		'application/gzip',
		'application/x-gzip',
		'application/x-gtar',
		'application/x-tgz',
		'application/x-compressed-tar',
		'application/tar+gzip',
	];
	private static tarGzExtensions = [ '.tar.gz', '.tgz' ];

	private static sqlTypes = [
		'application/sql',
		'application/x-sql',
		'text/sql',
		'text/x-sql',
		'text/plain',
	];
	private static sqlExtensions = [ '.sql' ];

	static create( file: BackupArchiveInfo ): BackupHandler | undefined {
		if ( this.isZip( file ) ) {
			return new BackupHandlerZip();
		} else if ( this.isTarGz( file ) ) {
			return new BackupHandlerTarGz();
		} else if ( this.isSql( file ) ) {
			return new BackupHandlerSql();
		} else if ( this.isWpress( file ) ) {
			return new BackupHandlerWpress();
		}
	}

	private static isZip( file: BackupArchiveInfo ): boolean {
		return (
			this.zipTypes.includes( file.type ) &&
			this.zipExtensions.some( ( ext ) => file.path.endsWith( ext ) )
		);
	}

	private static isTarGz( file: BackupArchiveInfo ): boolean {
		return (
			this.tarGzTypes.includes( file.type ) &&
			this.tarGzExtensions.some( ( ext ) => file.path.endsWith( ext ) )
		);
	}

	private static isSql( file: BackupArchiveInfo ): boolean {
		return (
			( this.sqlTypes.includes( file.type ) || ! file.type ) &&
			this.sqlExtensions.some( ( ext ) => file.path.endsWith( ext ) )
		);
	}

	private static isWpress( file: BackupArchiveInfo ): boolean {
		return file.path.endsWith( '.wpress' );
	}
}
