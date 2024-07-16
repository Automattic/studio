import { BackupArchiveInfo } from '../types';
import { BackupHandlerSql } from './backup-handler-sql';
import { BackupHandlerTarGz } from './backup-handler-tar-gz';
import { BackupHandlerZip } from './backup-handler-zip';

export interface BackupHandler {
	listFiles( file: BackupArchiveInfo ): Promise< string[] >;
	extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void >;
}

const EXCLUDED_FILES_PATTERNS = [
	/^__MACOSX\/.*/, // MacOS meta folder
	/^\..*/, // Unix hidden files at root
	/\/\..*/, // Unix hidden files at subfolders
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

	static create( file: BackupArchiveInfo ): BackupHandler {
		if ( this.isZip( file ) ) {
			return new BackupHandlerZip();
		} else if ( this.isTarGz( file ) ) {
			return new BackupHandlerTarGz();
		} else if ( this.isSql( file ) ) {
			return new BackupHandlerSql();
		} else {
			throw new Error( 'Unsupported file format. Only zip, tar.gz, and sql files are supported.' );
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
}
