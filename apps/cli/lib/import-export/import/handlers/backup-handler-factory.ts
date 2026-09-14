import { isGzipFile } from '@studio/common/lib/archive-format';
import { BackupArchiveInfo } from '../types';
import { BackupHandlerSql } from './backup-handler-sql';
import { BackupHandlerTarGz } from './backup-handler-tar-gz';
import { BackupHandlerWpress } from './backup-handler-wpress';
import { BackupHandlerXml } from './backup-handler-xml';
import { BackupHandlerZip } from './backup-handler-zip';
import type { ImportExportEventEmitter } from '../../events';

export interface BackupHandler extends ImportExportEventEmitter {
	listFiles( file: BackupArchiveInfo ): Promise< string[] >;
	extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void >;
}

const EXCLUDED_FILES_PATTERNS = [
	/^__MACOSX\/.*/, // macOS resource fork folder in zip archives
	/(^|\/)\.DS_Store$/, // macOS Finder metadata
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

	private static tarTypes = [
		'application/gzip',
		'application/x-gzip',
		'application/x-gtar',
		'application/x-tgz',
		'application/x-compressed-tar',
		'application/tar+gzip',
		'application/x-tar',
		'application/tar',
	];
	private static tarExtensions = [ '.tar.gz', '.tgz', '.tar' ];

	private static sqlTypes = [
		'application/sql',
		'application/x-sql',
		'text/sql',
		'text/x-sql',
		'text/plain',
	];
	private static sqlExtensions = [ '.sql' ];

	private static xmlTypes = [ 'application/xml', 'text/xml' ];
	private static xmlExtensions = [ '.xml' ];

	static create( file: BackupArchiveInfo ): BackupHandler | undefined {
		// Matched against for extensions only: the real path stays untouched for
		// filesystem reads, which are case-sensitive on some volumes.
		const name = file.path.toLowerCase();

		if ( this.isZip( file, name ) ) {
			return new BackupHandlerZip();
		} else if ( this.isTar( file, name ) ) {
			return new BackupHandlerTarGz();
		} else if ( this.isSql( file, name ) ) {
			return new BackupHandlerSql();
		} else if ( this.isXml( file, name ) ) {
			return new BackupHandlerXml();
		} else if ( this.isWpress( name ) ) {
			return new BackupHandlerWpress();
		} else if ( this.isUnlabelledGzip( file ) ) {
			return new BackupHandlerTarGz();
		}
	}

	private static isZip( file: BackupArchiveInfo, name: string ): boolean {
		return (
			this.zipTypes.includes( file.type ) &&
			this.zipExtensions.some( ( ext ) => name.endsWith( ext ) )
		);
	}

	private static isTar( file: BackupArchiveInfo, name: string ): boolean {
		return (
			this.tarTypes.includes( file.type ) &&
			this.tarExtensions.some( ( ext ) => name.endsWith( ext ) )
		);
	}

	// Last resort, so a gzipped .sql/.xml/.wpress still reaches its own handler:
	// only files no extension could place fall back to reading the header.
	private static isUnlabelledGzip( file: BackupArchiveInfo ): boolean {
		return isGzipFile( file.path );
	}

	private static isSql( file: BackupArchiveInfo, name: string ): boolean {
		return (
			( this.sqlTypes.includes( file.type ) || ! file.type ) &&
			this.sqlExtensions.some( ( ext ) => name.endsWith( ext ) )
		);
	}

	private static isXml( file: BackupArchiveInfo, name: string ): boolean {
		return (
			( this.xmlTypes.includes( file.type ) || ! file.type ) &&
			this.xmlExtensions.some( ( ext ) => name.endsWith( ext ) )
		);
	}

	private static isWpress( name: string ): boolean {
		return name.endsWith( '.wpress' );
	}
}
