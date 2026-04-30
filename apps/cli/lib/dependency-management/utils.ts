import fs from 'fs';
import path from 'path';
import ignore from 'ignore';

export { downloadFile } from '@studio/common/lib/download-file';

const IGNORE_PATTERNS = [ '.DS_Store', 'Thumbs.db' ];
const IGNORE_INSTANCE = ignore().add( IGNORE_PATTERNS );

type FileMetadata = {
	mtimeMs: number;
	size: number;
};

async function collectDirectoryMetadata(
	directoryPath: string,
	basePath = directoryPath
): Promise< Map< string, FileMetadata > > {
	const files = new Map< string, FileMetadata >();
	const entries = await fs.promises.readdir( directoryPath, { withFileTypes: true } );

	for ( const entry of entries ) {
		const fullPath = path.join( directoryPath, entry.name );
		const relativePath = path.relative( basePath, fullPath );

		if ( IGNORE_INSTANCE.ignores( relativePath ) ) {
			continue;
		}

		if ( entry.isDirectory() ) {
			const nestedFiles = await collectDirectoryMetadata( fullPath, basePath );
			for ( const [ key, value ] of nestedFiles ) {
				files.set( key, value );
			}
			continue;
		}

		if ( ! entry.isFile() ) {
			continue;
		}

		const stats = await fs.promises.lstat( fullPath );
		files.set( relativePath, { size: stats.size, mtimeMs: Math.floor( stats.mtimeMs ) } );
	}

	return files;
}

// Returns true when source and target have any file-level differences by relative path, size, or mtime.
export async function areDirectoriesDifferentBySizeAndMtime(
	sourceDirectoryPath: string,
	targetDirectoryPath: string
): Promise< boolean > {
	if ( ! fs.existsSync( sourceDirectoryPath ) || ! fs.existsSync( targetDirectoryPath ) ) {
		return true;
	}

	const [ sourceFiles, targetFiles ] = await Promise.all( [
		collectDirectoryMetadata( sourceDirectoryPath ),
		collectDirectoryMetadata( targetDirectoryPath ),
	] );

	if ( sourceFiles.size !== targetFiles.size ) {
		return true;
	}

	for ( const [ relativePath, sourceMetadata ] of sourceFiles ) {
		const targetMetadata = targetFiles.get( relativePath );
		if ( ! targetMetadata ) {
			return true;
		}

		if (
			sourceMetadata.size !== targetMetadata.size ||
			sourceMetadata.mtimeMs !== targetMetadata.mtimeMs
		) {
			return true;
		}
	}

	return false;
}
