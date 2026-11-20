<?php
/**
 * Pages for one set of values, such as opening hours. These are ordinary
 * Settings API pages, saved through `options.php`.
 *
 * @package CurateAdmin
 */

defined( 'ABSPATH' ) || exit;

/**
 * The admin page slug of a setting.
 *
 * @param array $setting Setting from the manifest.
 */
function curate_admin_settings_page( array $setting ): string {
	return "curate-admin-{$setting['id']}";
}

add_action(
	'admin_init',
	static function () {
		foreach ( curate_admin_settings() as $setting ) {
			$page = curate_admin_settings_page( $setting );

			register_setting(
				$page,
				$setting['option'],
				array(
					'type'              => 'object',
					'default'           => array(),
					'sanitize_callback' => static function ( $values ) use ( $setting ) {
						return curate_admin_sanitize_settings( $setting, (array) $values );
					},
				)
			);

			// Staff have no `manage_options`, which `options.php` asks for by default.
			// Only for saving: without `action=update`, it lists every option on the site.
			add_filter(
				"option_page_capability_{$page}",
				static function () {
					// phpcs:ignore WordPress.Security.NonceVerification.Recommended
					$saving = 'update' === ( $_REQUEST['action'] ?? '' );
					return $saving && curate_admin_is_staff() ? 'read' : 'manage_options';
				}
			);

			add_settings_section( 'default', '', '__return_null', $page );
			foreach ( $setting['fields'] as $field ) {
				add_settings_field(
					$field['key'],
					esc_html( $field['label'] ),
					'curate_admin_render_setting',
					$page,
					'default',
					array(
						'label_for' => "curate-admin-{$field['key']}",
						'setting'   => $setting,
						'field'     => $field,
					)
				);
			}
		}
	}
);

/**
 * Keeps only the setting's own fields, cleaned.
 *
 * @param array $setting Setting from the manifest.
 * @param array $values  Submitted values.
 */
function curate_admin_sanitize_settings( array $setting, array $values ): array {
	$clean = get_option( $setting['option'], array() );
	foreach ( $setting['fields'] as $field ) {
		if ( array_key_exists( $field['key'], $values ) ) {
			$clean[ $field['key'] ] = 'textarea' === $field['type']
				? sanitize_textarea_field( (string) $values[ $field['key'] ] )
				: sanitize_text_field( (string) $values[ $field['key'] ] );
		}
	}
	return $clean;
}

/**
 * Renders one settings field.
 *
 * @param array $args Field arguments from `add_settings_field`.
 */
function curate_admin_render_setting( array $args ): void {
	$setting = $args['setting'];
	$field   = $args['field'];
	$id      = $args['label_for'];
	$name    = "{$setting['option']}[{$field['key']}]";
	$value   = (string) ( get_option( $setting['option'], array() )[ $field['key'] ] ?? '' );

	if ( 'textarea' === $field['type'] ) {
		printf(
			'<textarea id="%s" name="%s" rows="4" class="large-text">%s</textarea>',
			esc_attr( $id ),
			esc_attr( $name ),
			esc_textarea( $value )
		);
		return;
	}
	printf(
		'<input id="%s" name="%s" type="text" class="regular-text" value="%s">',
		esc_attr( $id ),
		esc_attr( $name ),
		esc_attr( $value )
	);
}

add_action(
	'admin_menu',
	static function () {
		foreach ( curate_admin_settings() as $setting ) {
			$page = curate_admin_settings_page( $setting );
			add_menu_page(
				$setting['title'],
				$setting['label'] ?? $setting['title'],
				curate_admin_is_staff() ? 'read' : 'manage_options',
				$page,
				static function () use ( $setting, $page ) {
					?>
					<div class="wrap">
						<h1><?php echo esc_html( $setting['title'] ); ?></h1>
						<?php settings_errors(); ?>
						<form action="<?php echo esc_url( admin_url( 'options.php' ) ); ?>" method="post">
							<?php
							settings_fields( $page );
							do_settings_sections( $page );
							submit_button();
							?>
						</form>
					</div>
					<?php
				},
				$setting['icon'] ?? 'dashicons-admin-generic'
			);
		}
	}
);
