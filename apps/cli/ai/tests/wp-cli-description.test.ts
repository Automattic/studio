import { getSiteDatabaseEngine } from '@studio/common/lib/site-database';
import { runWpCliTool } from '../tools/wp-cli';

vi.mock( '@studio/common/lib/site-database', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/site-database') >() ),
	getSiteDatabaseEngine: vi.fn().mockReturnValue( 'sqlite' ),
} ) );

describe( 'WP-CLI database description', () => {
	it( 'uses the default engine helper and preserves the SQLite guidance verbatim', () => {
		expect( getSiteDatabaseEngine ).toHaveBeenCalledWith();
		expect( runWpCliTool.description ).toContain(
			'Studio sites use SQLite, not MySQL (the database file is `<site-path>/wp-content/database/.ht.sqlite`): `db query` and the other `db` subcommands do not work, so query WordPress data with object commands such as `post list`, `option get`, or `user list`. ' +
				'Users can browse the database themselves with phpMyAdmin from the site overview in the Studio app while the site is running, or with `sqlite3 <site-path>/wp-content/database/.ht.sqlite` (pre-installed on macOS).'
		);
	} );
} );
