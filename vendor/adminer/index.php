<?php
/**
 * Adminer configuration for WordPress Studio.
 */

require_once( dirname( __FILE__ ) . '/config.php' );

// Utils
function wp_studio_escape_html( $string ) {
	return htmlspecialchars( $string, ENT_QUOTES, 'UTF-8' );
}

/**
 * Creates and returns the Adminer object with custom configuration.
 *
 * @return AdminerEditorCustomizations
 */
function adminer_object() {
  // @see https://github.com/vrana/adminer/blob/master/editor/include/adminer.inc.php for overrideable methods.
	class AdminerEditorCustomizations extends Adminer\Adminer {
		/**
		 * Modifies the login form field to default to SQLite.
		 *
		 * @param string $name    Field name.
		 * @param string $heading Field heading.
		 * @param string $value   Field value.
		 * @return string
		 */
		public function loginFormField( $name, $heading, $value ) {
			return parent::loginFormField( $name, $heading, str_replace( 'value="server"', 'value="sqlite"', $value ) );
		}

		/**
		 * Returns the path to the SQLite database.
		 *
		 * @return string
		 */
		public function database() {
			return ADMINER_SQLITE_DATABASE_PATH;
		}

		/**
		 * Returns the custom name for the admin interface.
		 *
		 * @return string
		 */
		public function name() {
			return 'WordPress Studio';
		}

		/**
		 * Returns the server name display.
         * Get server name displayed in breadcrumbs.
		 *
		 * @param string $server Server name.
		 * @return string
		 */
		public function serverName( $server ) {
			return 'WordPress Studio';
		}

		/**
		 * Validates user credentials.
		 *
		 * @param string $login    Username.
		 * @param string $password Password.
		 * @return bool
		 */
		public function login( $login, $password ) {
			/**
			 * Enable login for password-less database.
			 * Taken from AdminerLoginWithoutCredentials.
			 * @see https://github.com/dg/adminer/blob/master/adminer-plugins/login-without-credentials.php
			 * @link https://www.adminer.org/plugins/#use
			 * @author Jakub Vrana, https://www.vrana.cz/
			 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache License, Version 2.0
			 * @license https://www.gnu.org/licenses/gpl-2.0.html GNU General Public License, version 2 (one or other)
			 */
			$local = ! isset( $_SERVER['HTTP_X_FORWARDED_FOR'] )
				&& isset( $_SERVER['REMOTE_ADDR'] )
				&& in_array( $_SERVER['REMOTE_ADDR'], ['localhost', '127.0.0.1'], true );
			return $local ? true : null;
		}

		/**
		 * Table caption used in navigation and headings
		 * @param array result of SHOW TABLE STATUS
		 * @return string HTML code, "" to ignore table
		 */
		function tableName( $tableStatus ) {
			if ( strpos( $tableStatus['Name'], 'wp_' ) !== 0 ) {
				return '';
			}
			return $tableStatus['Name'];
		}

		/**
		 * Returns query timeout in seconds.
		 *
		 * @return int
		 */
		public function queryTimeout() {
			return 5;
		}

		/**
		 * Returns Content Security Policy headers.
		 *
		 * @return array Array of arrays with directive name in key, allowed sources in value.
		 */
		public function csp( $csp = array() ) {
			return array();
		}

		// Prevents printing "New item" link.
		function selectLinks( $tableStatus, $set = '' ) {}

		// Prevents printing "Import" link.
		function selectImportPrint() {
			return false;
		}

		/**
		 * Outputs HTML code inside <head>.
		 *
		 * @param bool|null $dark CSS: false to disable, true to force, null to base on user preferences.
		 * @return bool True to link favicon.ico.
		 */
		public function head( $dark = null ) {
			// This is matched by compile.php.
			echo "<link rel='stylesheet' href='../externals/jush/jush.css'>\n";
			
			if ( $dark !== false ) {
				$dark_media = $dark ? '' : " media='(prefers-color-scheme: dark)'";
				echo "<link rel='stylesheet'{$dark_media} href='../externals/jush/jush-dark.css'>\n";
			}

			?>
			<script>
				document.addEventListener( 'DOMContentLoaded', function() {
					if ( document.querySelector( '#logout' ) ) {
						document.querySelector( '#logout' ).remove();
					}

					if ( document.querySelector( '#breadcrumb' ) ) {
						const arrow = '&nbsp;<span style="font-size: 12px;rotate: 90deg;display: inline-block;"> &#8598;</span>';
						document.querySelector( '#breadcrumb' ).innerHTML = '<a target="_blank" href="<?php echo wp_studio_escape_html( ADMINER_WP_SITE_URL ); ?>">' + '<?php echo wp_studio_escape_html( ADMINER_I18N['openSite'] ); ?>' + arrow + '</a>&nbsp;&nbsp;&nbsp;&nbsp;<a target="_blank" href="<?php echo wp_studio_escape_html( ADMINER_WP_ADMIN_URL ); ?>?playground-auto-login=true">WP admin' + arrow + '</a>';
					}

					if ( document.querySelector( '#menu > h1:first-child' ) ) {
						document.querySelector( '#menu > h1:first-child' ).innerHTML = '<?php echo wp_studio_escape_html( ADMINER_WP_SITE_NAME ); ?> - <a href="<?php echo wp_studio_escape_html( ADMINER_WP_DATABASE_ADMIN_URL ); ?>?sqlite=&username="><?php echo wp_studio_escape_html( ADMINER_I18N['siteTables'] ); ?></a>';
					}

					// Login form - auto login.
					if ( ! document.querySelector( '[name="auth[username]"]' ) || ! document.querySelector( '[name="auth[password]"]' ) ) {
						return;
					}
					if ( document.querySelector( '[name="auth[permanent]"]' ) ) {
						document.querySelector( '[name="auth[permanent]"]' ).closest( 'label' ).remove();
					}
					document.querySelector( '[name="auth[username]"]' ).disabled = true;
					document.querySelector( '[name="auth[password]"]' ).disabled = true;
					document.querySelector( '[name="auth[driver]"]' ).value = 'sqlite';
					document.querySelector( 'input[type="submit"]' ).click();
				} );
			</script>
			<?php

			return true;
		}
	}

	return new AdminerEditorCustomizations();
}

require_once( dirname( __FILE__ ) . '/editor-5.1.1.php' );


?>