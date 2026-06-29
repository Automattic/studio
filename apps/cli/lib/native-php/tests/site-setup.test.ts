import { describe, expect, it } from 'vitest';
import { getSiteUrlPrependContent } from '../site-setup';

describe( 'getSiteUrlPrependContent', () => {
	it( 'defines WP_HOME/WP_SITEURL from the request, guarded against redefining', () => {
		const content = getSiteUrlPrependContent();
		expect( content ).toContain( "define( 'WP_HOME', $studio_local_url )" );
		expect( content ).toContain( "define( 'WP_SITEURL', $studio_local_url )" );
		expect( content ).toContain( "! defined( 'WP_HOME' )" );
		expect( content ).toContain( "! defined( 'WP_SITEURL' )" );
		// wp-cli has no request host; leave the stored URL alone there.
		expect( content ).toContain( "PHP_SAPI !== 'cli'" );
		// No chained require when there is no original prepend.
		expect( content ).not.toContain( 'require ' );
	} );

	it( 'chains to the original auto_prepend_file when given', () => {
		const content = getSiteUrlPrependContent( '/imports/site/runtime.php' );
		expect( content ).toContain( "require '/imports/site/runtime.php';" );
	} );

	it( 'escapes single quotes in the chained path', () => {
		const content = getSiteUrlPrependContent( "/imports/o'brien/runtime.php" );
		expect( content ).toContain( "require '/imports/o\\'brien/runtime.php';" );
	} );
} );
