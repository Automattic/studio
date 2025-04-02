<?php
/**
 * Adminer configuration for WordPress Studio
 *
 * @TODO
 * - Create and use constants with site details so we can use them here.
 * - Add link to WordPress admin and WordPress site.
 */

/**
 * Creates and returns the Adminer object with custom configuration.
 *
 * @return AdminerSoftware
 */
function adminer_object() {
  // @see https://github.com/vrana/adminer/blob/v5.1.0/adminer/include/adminer.inc.php for overrideable methods.
	class AdminerSoftware extends Adminer\Adminer {
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
			return dirname( __DIR__ ) . '/wp-content/database/.ht.sqlite'; // @TODO abstract
		}

		/**
		 * Returns the custom name for the admin interface.
		 *
		 * @return string
		 */
		public function name() {
			return 'Studio';
		}

		/**
		 * Validates user credentials.
		 *
		 * @param string $login    Username.
		 * @param string $password Password.
		 * @return bool
		 */
		public function login( $login, $password ) {
			return true;
		}

		/**
		 * Returns the server name display.
		 *
		 * @param string $server Server name.
		 * @return string
		 */
		public function serverName( $server ) {
			return 'My WordPress Site'; // @TODO use site name
		}

		/**
		 * Returns available databases.
		 *
		 * @param bool $flush Whether to flush the cache.
		 * @return array
		 */
		public function databases( $flush = true ) {
			if ( isset( $_GET['sqlite'] ) ) {
				return array( dirname( __DIR__ ) . '/wp-content/database/.ht.sqlite' );
			}
			return get_databases( $flush );
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
		public function csp() {
			return array();
		}

		/**
		 * Outputs HTML code inside <head>.
		 *
		 * @param bool|null $dark CSS: false to disable, true to force, null to base on user preferences.
		 * @return bool True to link favicon.ico.
		 */
		public function head( $dark = null ) {
			$db_path = dirname( __DIR__ ) . '/wp-content/database/.ht.sqlite';

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

				if ( ! document.querySelector( '#username' ) || ! document.querySelector( '[name="auth[password]"]' ) ) {
					return;
				}

				document.querySelector( '#username' ).disabled = true;
				document.querySelector( '[name="auth[password]"]' ).disabled = true;
				document.querySelector( '[name="auth[permanent]"]' ).closest( 'label' ).style.display = 'none';
				document.querySelector( '[name="auth[db]"]' ).value = '<?php echo $db_path; ?>';
				document.querySelector( 'input[type="submit"]' ).click();
			} );
			</script>
			<?php

			return true;
		}
	}

	return new AdminerSoftware();
}

include 'adminer-5.1.0.php';


?>