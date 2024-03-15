import fs from 'fs';
import nodePath from 'path';

export async function getImageData( path: string ) {
	if ( ! fs.existsSync( path ) ) {
		return null;
	}
	const buffer = fs.readFileSync( path );
	const extension = nodePath.extname( path ).slice( 1 ).toLowerCase();
	return `data:image/${ extension };base64,${ buffer.toString( 'base64' ) }`;
}
