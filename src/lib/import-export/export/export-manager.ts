import { ExportOptions } from './types';

export async function exportBackup(
	exportOptions: ExportOptions,
	_validators = [],
	_importers = []
): Promise< void > {
	const allFiles = await fsPromises.readdir( exportOptions.sitePath, {
		recursive: true,
		withFileTypes: true,
	} );
	console.log( allFiles );
}
