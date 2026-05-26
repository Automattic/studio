import { __ } from '@wordpress/i18n';

export function getAppGlobals(): AppGlobals {
	return window.appGlobals;
}

export function isMac() {
	if ( process.env.NODE_ENV === 'test' ) {
		return true;
	}
	return getAppGlobals().platform === 'darwin';
}

export function isWindows() {
	if ( process.env.NODE_ENV === 'test' ) {
		return false;
	}
	return getAppGlobals().platform === 'win32';
}

export function isLinux() {
	if ( process.env.NODE_ENV === 'test' ) {
		return false;
	}
	return getAppGlobals().platform === 'linux';
}

export function isWindowsStore() {
	return getAppGlobals().isWindowsStore;
}

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
