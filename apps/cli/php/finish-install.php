<?php
/**
 * Loaded into `wp core install` with `--require`, so Studio's options are set by the
 * process that installs WordPress instead of by one PHP process each.
 */
WP_CLI::add_hook(
	'after_invoke:core install',
	function () {
		update_option( 'studio_admin_username', WP_CLI::get_runner()->assoc_args['admin_user'] );
		if ( ! get_option( 'permalink_structure' ) ) {
			update_option( 'permalink_structure', '/%year%/%monthnum%/%day%/%postname%/' );
		}
	}
);
