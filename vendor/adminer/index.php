<?php
/**
 * Adminer configuration for WordPress Studio.
 */

require_once( dirname( __FILE__ ) . '/config.php' );

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
			return ADMINER_SQLITE_DATABASE_PATH;
		}

		/**
		 * Returns the custom name for the admin interface.
		 *
		 * @return string
		 */
		public function name() {
			return 'WordPress Studio - ' . htmlspecialchars( ADMINER_WP_SITE_NAME, ENT_QUOTES, 'UTF-8' );
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
     * Get server name displayed in breadcrumbs.
		 *
		 * @param string $server Server name.
		 * @return string
		 */
		public function serverName( $server ) {
			return ADMINER_WP_SITE_NAME;
		}

		/**
		 * Returns available databases.
		 *
		 * @param bool $flush Whether to flush the cache.
		 * @return array
		 */
		public function databases( $flush = true ) {
			if ( isset( $_GET['sqlite'] ) ) {
				return array( ADMINER_SQLITE_DATABASE_PATH );
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
			$db_path = ADMINER_SQLITE_DATABASE_PATH;

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

        if ( document.querySelector( '#menu > h1:first-child' ) ) {
					document.querySelector( '#menu > h1:first-child' ).innerHTML = 'WordPress Studio - <a href="<?php echo htmlspecialchars( ADMINER_WP_SITE_URL, ENT_QUOTES, 'UTF-8' ); ?>" target="_blank">' + '<?php echo htmlspecialchars( ADMINER_WP_SITE_NAME, ENT_QUOTES, 'UTF-8' ); ?>' + ' &#8663;</a>';
				}

        // Login form.
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