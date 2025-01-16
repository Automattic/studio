import fs from 'fs';
import path from 'path';

export function calculateDirectorySize( directoryPath: string ): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		let totalSize = 0;

		function calculateSize( dirPath: string ): Promise< void > {
			return new Promise( ( resolveDir ) => {
				fs.readdir( dirPath, { withFileTypes: true }, async ( err, files ) => {
					await Promise.all(
						files.map( async ( file ) => {
							const filePath = path.join( dirPath, file.name );
							if ( file.isDirectory() ) {
								await calculateSize( filePath );
							} else {
								const stats = await fs.promises.stat( filePath );
								totalSize += stats.size;
							}
						} )
					);
					resolveDir();
				} );
			} );
		}

		calculateSize( directoryPath )
			.then( () => resolve( totalSize ) )
			.catch( reject );
	} );
}
