import { __ } from '@wordpress/i18n';

export function splitFolderPath( path: string ) {
	const separator = Math.max( path.lastIndexOf( '/' ), path.lastIndexOf( '\\' ) );
	return { parent: path.slice( 0, separator + 1 ), name: path.slice( separator + 1 ) };
}

export function getFolderNameError( name: string ) {
	if ( ! name.trim() ) return __( 'Site folder is required.' );
	if ( name === '.' || name === '..' ) return __( 'Enter a folder name other than “.” or “..”.' );
	return '';
}
