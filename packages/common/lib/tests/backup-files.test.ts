import { describe, expect, it } from 'vitest';
import {
	getSuggestedSiteNameFromBackupFilename,
	isSupportedBackupFilename,
} from '@studio/common/lib/backup-files';

describe( 'backup files', () => {
	it.each( [
		'backup.zip',
		'backup.tar.gz',
		'backup.gz',
		'backup.gzip',
		'backup.tar',
		'backup.wpress',
		'backup.sql',
	] )( 'supports %s', ( filename ) => {
		expect( isSupportedBackupFilename( filename ) ).toBe( true );
	} );

	it( 'rejects unsupported filenames', () => {
		expect( isSupportedBackupFilename( 'backup.txt' ) ).toBe( false );
		expect( isSupportedBackupFilename( 'backup.sql.zip.exe' ) ).toBe( false );
	} );

	it.each( [
		[ 'studio-backup-My Store-2026-07-17_12_30_45.tar.gz', 'My Store' ],
		[ '/Users/me/Sites/client-site-backup.zip', 'client site' ],
		[ 'Agency_Export.wpress', 'Agency' ],
		[ 'shop-2026-07-17.sql', 'shop' ],
		[ 'my-site.tar.gz', 'my site' ],
	] )( 'suggests a site name from %s', ( filename, expected ) => {
		expect( getSuggestedSiteNameFromBackupFilename( filename ) ).toBe( expected );
	} );
} );
