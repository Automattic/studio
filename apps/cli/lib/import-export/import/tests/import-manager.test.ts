import { describe, it, expect } from 'vitest';
import { DEFAULT_IMPORTER_OPTIONS } from '../import-manager';
import { WxrImporter } from '../importers/wxr-importer';

// Mirrors the private `selectImporter` logic: the first validator whose
// `canHandle` returns true wins.
function selectImporterClass( fileList: string[] ) {
	for ( const { validator, importer } of DEFAULT_IMPORTER_OPTIONS ) {
		if ( validator.canHandle( fileList ) ) {
			return importer;
		}
	}
	return null;
}

describe( 'DEFAULT_IMPORTER_OPTIONS', () => {
	it( 'selects the WxrImporter for a lone .xml file', () => {
		expect( selectImporterClass( [ 'export.xml' ] ) ).toBe( WxrImporter );
	} );

	it( 'does not select the WxrImporter for a .sql file', () => {
		expect( selectImporterClass( [ 'backup.sql' ] ) ).not.toBe( WxrImporter );
	} );
} );
