<?php
/**
 * The dashboard: which widgets stay, custom widgets, and the Help tabs that make
 * up the guide.
 *
 * @package CurateAdmin
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'admin_enqueue_scripts',
	static function ( $hook ) {
		if ( 'index.php' === $hook && curate_admin_is_curated() ) {
			wp_enqueue_style( 'curate-admin-layout', plugin_dir_url( CURATE_ADMIN_FILE ) . 'assets/admin-layout.css', array(), CURATE_ADMIN_VERSION );
		}
	}
);

/**
 * Renders a widget of links to admin screens.
 *
 * @param mixed $unused Unused.
 * @param array $widget Widget, with its definition in `args`.
 */
function curate_admin_render_links_widget( $unused, array $widget ): void {
	echo '<ul class="curate-admin-links">';
	foreach ( $widget['args']['links'] as $link ) {
		printf(
			'<li><a href="%s"><strong>%s</strong><span>%s</span></a></li>',
			esc_url( admin_url( $link['screen'] ) ),
			esc_html( $link['label'] ),
			esc_html( $link['description'] ?? '' )
		);
	}
	echo '</ul>';
}

/**
 * Renders a widget of the latest posts of a type, such as form entries.
 *
 * @param mixed $unused Unused.
 * @param array $widget Widget, with its definition in `args`.
 */
function curate_admin_render_recent_widget( $unused, array $widget ): void {
	$definition = $widget['args'];
	$posts      = post_type_exists( $definition['postType'] )
		? get_posts(
			array(
				'post_type'   => $definition['postType'],
				'post_status' => $definition['status'] ?? 'publish',
				'numberposts' => $definition['count'] ?? 5,
			)
		)
		: array();

	if ( ! $posts ) {
		echo '<p>' . esc_html__( 'Nothing new.', 'curate-admin' ) . '</p>';
		return;
	}
	echo '<ul>';
	foreach ( $posts as $post ) {
		printf(
			'<li>%s <span class="description">%s</span></li>',
			esc_html( get_the_title( $post ) ),
			esc_html( get_the_date( '', $post ) )
		);
	}
	echo '</ul>';
}

/**
 * Renders the form that asks the agency for a change.
 */
function curate_admin_render_requests_widget(): void {
	$agency = curate_admin_manifest()['agency'] ?? array();
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	if ( isset( $_GET['curate-admin-sent'] ) ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$sent = '1' === $_GET['curate-admin-sent'];
		printf(
			'<div class="notice notice-%s inline"><p>%s</p></div>',
			$sent ? 'success' : 'error',
			esc_html( $sent ? __( 'Sent. Thank you.', 'curate-admin' ) : __( 'That did not send. Please try again.', 'curate-admin' ) )
		);
	}
	if ( ! empty( $agency['responseTime'] ) ) {
		echo '<p>' . esc_html( $agency['responseTime'] ) . '</p>';
	}
	?>
	<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
		<input type="hidden" name="action" value="curate_admin_request">
		<?php wp_nonce_field( 'curate_admin_request' ); ?>
		<p>
			<label class="screen-reader-text" for="curate-admin-message"><?php esc_html_e( 'Your request', 'curate-admin' ); ?></label>
			<textarea id="curate-admin-message" name="message" rows="4" class="large-text" required></textarea>
		</p>
		<?php submit_button( __( 'Send request', 'curate-admin' ), 'secondary', 'submit', false ); ?>
	</form>
	<?php
}

/**
 * Whether a dashboard widget stays: `keep` for Staff, `hide` for everyone, so a
 * plugin added later still shows up for everyone.
 *
 * @param string $id Widget ID.
 */
function curate_admin_keeps_widget( string $id ): bool {
	$dashboard = curate_admin_manifest()['dashboard'] ?? array();
	return curate_admin_is_staff()
		? in_array( $id, $dashboard['keep'] ?? array(), true )
		: ! in_array( $id, $dashboard['hide'] ?? array(), true );
}

add_action(
	'wp_dashboard_setup',
	static function () {
		$dashboard = curate_admin_manifest()['dashboard'] ?? null;
		if ( ! $dashboard || ! curate_admin_is_curated() ) {
			return;
		}

		global $wp_meta_boxes;
		foreach ( (array) ( $wp_meta_boxes['dashboard'] ?? array() ) as $context => $priorities ) {
			foreach ( $priorities as $priority => $widgets ) {
				foreach ( array_keys( $widgets ) as $id ) {
					if ( ! curate_admin_keeps_widget( (string) $id ) ) {
						unset( $wp_meta_boxes['dashboard'][ $context ][ $priority ][ $id ] ); // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
					}
				}
			}
		}
		if ( empty( $dashboard['welcome'] ) ) {
			remove_action( 'welcome_panel', 'wp_welcome_panel' );
		}

		foreach ( $dashboard['widgets'] ?? array() as $widget ) {
			$id = "curate_admin_{$widget['id']}";
			if ( 'links' === $widget['type'] ) {
				wp_add_dashboard_widget( $id, $widget['title'], 'curate_admin_render_links_widget', null, $widget );
			} elseif ( 'recent' === $widget['type'] ) {
				wp_add_dashboard_widget( $id, $widget['title'], 'curate_admin_render_recent_widget', null, $widget, 'side' );
			} elseif ( curate_admin_accepts_requests() ) {
				wp_add_dashboard_widget( $id, $widget['title'], 'curate_admin_render_requests_widget', null, null, 'side' );
			}
		}
	},
	PHP_INT_MAX
);

/**
 * The HTML of a guide entry's Help tab: its steps and its capture, if there is one.
 *
 * @param array $entry Guide entry from the manifest.
 */
function curate_admin_help_html( array $entry ): string {
	$html = '<ol>';
	foreach ( $entry['steps'] as $step ) {
		$html .= '<li>' . esc_html( $step ) . '</li>';
	}
	$html .= '</ol>';

	$guide = apply_filters( 'curate_admin_guide', null );
	if ( $guide && is_readable( "{$guide['path']}/{$entry['id']}.jpg" ) ) {
		$html .= '<p><img src="' . esc_url( "{$guide['url']}/{$entry['id']}.jpg" ) . '" alt="" style="max-width:100%;border:1px solid #dcdcde"></p>';
	}
	return $html;
}

// In `admin_head`, because core adds a screen's own tabs after `current_screen`.
add_action(
	'admin_head',
	static function () {
		$screen = get_current_screen();
		$guide  = curate_admin_manifest()['guide'] ?? array();
		if ( ! $screen || ! $guide || ! curate_admin_is_curated() ) {
			return;
		}

		$screen->remove_help_tabs();
		foreach ( $guide as $entry ) {
			$screen->add_help_tab(
				array(
					'id'      => "curate-admin-{$entry['id']}",
					'title'   => $entry['title'],
					'content' => curate_admin_help_html( $entry ),
				)
			);
		}

		$agency = curate_admin_manifest()['agency'] ?? array();
		if ( ! empty( $agency['name'] ) ) {
			$screen->set_help_sidebar(
				sprintf(
					'<p><strong>%s</strong></p><p>%s</p>',
					esc_html__( 'Need a hand?', 'curate-admin' ),
					esc_html( $agency['responseTime'] ?? $agency['name'] )
				)
			);
		}
	}
);

add_filter(
	'admin_footer_text',
	static function ( $text ) {
		$agency = curate_admin_manifest()['agency']['name'] ?? '';
		if ( ! $agency || ! curate_admin_is_curated() ) {
			return $text;
		}
		/* translators: %s: agency name. */
		return esc_html( sprintf( __( 'Looked after by %s', 'curate-admin' ), $agency ) );
	}
);
