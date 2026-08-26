import { __ } from '@wordpress/i18n';
import { isLinux, isWindows } from 'src/lib/app-globals';

export function getFileManagerLabel(): string {
	if ( isWindows() ) {
		// translators: name of app used to navigate files and folders on Windows
		return __( 'File Explorer' );
	}
	if ( isLinux() ) {
		// translators: generic name of the app used to navigate files and folders on Linux
		return __( 'File Manager' );
	}
	// translators: name of app used to navigate files and folders on macOS
	return __( 'Finder' );
}
