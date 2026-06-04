import {
	archive,
	brush,
	category,
	code,
	cog,
	comment,
	dashboard,
	desktop,
	layout,
	login,
	media,
	navigation,
	page,
	pages,
	people,
	plugins,
	post,
	rss,
	settings as settingsIcon,
	styles as stylesIcon,
	symbolFilled,
} from '@wordpress/icons';
import { describe, expect, it } from 'vitest';
import { getWordPressTabIcon, getWordPressTabTitle } from './tab-icons';

describe( 'getWordPressTabIcon', () => {
	it( 'uses the site icon fallback for ordinary site paths', () => {
		expect( getWordPressTabIcon( '/' ) ).toBeNull();
		expect( getWordPressTabTitle( '/' ) ).toBeNull();
		expect( getWordPressTabIcon( '/about/' ) ).toBeNull();
		expect( getWordPressTabTitle( '/about/' ) ).toBeNull();
	} );

	it( 'identifies common WordPress entry points', () => {
		expect( getWordPressTabIcon( '/wp-admin/' ) ).toBe( dashboard );
		expect( getWordPressTabTitle( '/wp-admin/' ) ).toBe( 'Dashboard' );
		expect( getWordPressTabIcon( '/wp-admin/index.php' ) ).toBe( dashboard );
		expect( getWordPressTabIcon( '/wp-login.php' ) ).toBe( login );
		expect( getWordPressTabTitle( '/wp-login.php' ) ).toBe( 'Log in' );
		expect( getWordPressTabIcon( '/wp-json/wp/v2/pages' ) ).toBe( code );
		expect( getWordPressTabTitle( '/wp-json/wp/v2/pages' ) ).toBe( 'REST API' );
		expect( getWordPressTabIcon( '/feed/' ) ).toBe( rss );
		expect( getWordPressTabTitle( '/feed/' ) ).toBe( 'Feed' );
	} );

	it( 'maps admin content routes to content icons', () => {
		expect( getWordPressTabIcon( '/wp-admin/edit.php' ) ).toBe( post );
		expect( getWordPressTabTitle( '/wp-admin/edit.php' ) ).toBe( 'Posts' );
		expect( getWordPressTabIcon( '/wp-admin/edit.php?post_type=page' ) ).toBe( pages );
		expect( getWordPressTabTitle( '/wp-admin/edit.php?post_type=page' ) ).toBe( 'Pages' );
		expect( getWordPressTabIcon( '/wp-admin/post-new.php?post_type=page' ) ).toBe( page );
		expect( getWordPressTabTitle( '/wp-admin/post-new.php?post_type=page' ) ).toBe( 'New page' );
		expect( getWordPressTabIcon( '/wp-admin/upload.php' ) ).toBe( media );
		expect( getWordPressTabIcon( '/wp-admin/edit-comments.php' ) ).toBe( comment );
		expect( getWordPressTabIcon( '/wp-admin/edit-tags.php?taxonomy=category' ) ).toBe( category );
	} );

	it( 'maps appearance and site editor routes to specialized icons', () => {
		expect( getWordPressTabIcon( '/wp-admin/themes.php' ) ).toBe( brush );
		expect( getWordPressTabIcon( '/wp-admin/nav-menus.php' ) ).toBe( navigation );
		expect( getWordPressTabIcon( '/wp-admin/widgets.php' ) ).toBe( layout );
		expect( getWordPressTabIcon( '/wp-admin/site-editor.php' ) ).toBe( desktop );
		expect( getWordPressTabTitle( '/wp-admin/site-editor.php' ) ).toBe( 'Site Editor' );
		expect( getWordPressTabIcon( '/wp-admin/site-editor.php?path=%2Fwp_global_styles' ) ).toBe(
			stylesIcon
		);
		expect( getWordPressTabTitle( '/wp-admin/site-editor.php?path=%2Fwp_global_styles' ) ).toBe(
			'Styles'
		);
		expect( getWordPressTabIcon( '/wp-admin/site-editor.php?path=%2Fpatterns' ) ).toBe(
			symbolFilled
		);
		expect( getWordPressTabTitle( '/wp-admin/site-editor.php?path=%2Fpatterns' ) ).toBe(
			'Patterns'
		);
		expect( getWordPressTabIcon( '/wp-admin/site-editor.php?path=%2Fnavigation' ) ).toBe(
			navigation
		);
		expect( getWordPressTabTitle( '/wp-admin/site-editor.php?path=%2Fnavigation' ) ).toBe(
			'Navigation'
		);
		expect( getWordPressTabIcon( '/wp-admin/site-editor.php?path=%2Fwp_template' ) ).toBe( layout );
		expect( getWordPressTabTitle( '/wp-admin/site-editor.php?path=%2Fwp_template' ) ).toBe(
			'Templates'
		);
		expect( getWordPressTabIcon( '/wp-admin/site-editor.php?path=%2Fpage' ) ).toBe( pages );
		expect( getWordPressTabTitle( '/wp-admin/site-editor.php?path=%2Fpage' ) ).toBe( 'Pages' );
	} );

	it( 'maps management routes to relevant admin icons', () => {
		expect( getWordPressTabIcon( '/wp-admin/plugins.php' ) ).toBe( plugins );
		expect( getWordPressTabTitle( '/wp-admin/plugins.php' ) ).toBe( 'Plugins' );
		expect( getWordPressTabIcon( '/wp-admin/users.php' ) ).toBe( people );
		expect( getWordPressTabTitle( '/wp-admin/users.php' ) ).toBe( 'Users' );
		expect( getWordPressTabIcon( '/wp-admin/options-general.php' ) ).toBe( settingsIcon );
		expect( getWordPressTabTitle( '/wp-admin/options-general.php' ) ).toBe( 'Settings' );
		expect( getWordPressTabIcon( '/wp-admin/tools.php' ) ).toBe( archive );
		expect( getWordPressTabTitle( '/wp-admin/tools.php' ) ).toBe( 'Tools' );
		expect( getWordPressTabIcon( '/wp-admin/admin.php?page=my-plugin-settings' ) ).toBe( plugins );
		expect( getWordPressTabTitle( '/wp-admin/admin.php?page=my-plugin-settings' ) ).toBe(
			'Plugins'
		);
		expect( getWordPressTabIcon( '/wp-admin/admin.php?page=unknown' ) ).toBe( cog );
		expect( getWordPressTabTitle( '/wp-admin/admin.php?page=unknown' ) ).toBe( 'Admin' );
	} );
} );
