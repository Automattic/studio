import fsPromises from 'fs/promises';
import path from 'node:path';
import { ExportOptions } from './types';

export async function exportBackup(
	exportOptions: ExportOptions,
	_validators = [],
	_importers = []
): Promise< void > {
	const directoryContents = await fsPromises.readdir( exportOptions.sitePath, {
		recursive: true,
		withFileTypes: true,
	} );
	const allFiles = directoryContents.reduce( ( files: string[], directoryContent ) => {
		if ( directoryContent.isFile() ) {
			files.push( path.join( directoryContent.path, directoryContent.name ) );
		}
		return files;
	}, [] as string[] );
	console.log( allFiles );
}
