import path from 'path';
import { downloadFiles, getWordPressResourceFiles } from '../common/lib/resource-downloader';

const WP_SERVER_FILES_PATH = path.join( __dirname, '..', 'wp-files' );

const downloadAllFiles = async () => {
	const files = getWordPressResourceFiles( WP_SERVER_FILES_PATH );

	try {
		await downloadFiles( files, WP_SERVER_FILES_PATH );
	} catch ( err ) {
		console.error( err );
		process.exit( 1 );
	}
};

downloadAllFiles();
