export function getBackupFileType( importFile: string ): string {
	const normalizedPath = importFile.toLowerCase();

	if ( normalizedPath.endsWith( '.tar.gz' ) || normalizedPath.endsWith( '.tgz' ) ) {
		return 'application/gzip';
	}

	if ( normalizedPath.endsWith( '.zip' ) ) {
		return 'application/zip';
	}

	if ( normalizedPath.endsWith( '.sql' ) ) {
		return 'application/sql';
	}

	if ( normalizedPath.endsWith( '.xml' ) ) {
		return 'application/xml';
	}

	return '';
}
