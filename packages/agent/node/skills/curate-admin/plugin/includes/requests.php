<?php
/**
 * Change requests: what a client asks the agency for when something is locked.
 *
 * Requests are stored on the site as well as emailed, so a failed email loses
 * nothing. Administrators read them on a regular post list.
 *
 * @package ClientAdmin
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'init',
	static function () {
		if ( ! client_admin_accepts_requests() ) {
			return;
		}

		$capabilities = array_fill_keys(
			array( 'edit_posts', 'edit_others_posts', 'edit_private_posts', 'edit_published_posts', 'read_private_posts', 'delete_posts', 'delete_others_posts', 'delete_private_posts', 'delete_published_posts' ),
			'manage_options'
		);

		register_post_type(
			'client_request',
			array(
				'label'           => __( 'Change requests', 'client-admin' ),
				'public'          => false,
				'show_ui'         => true,
				'show_in_rest'    => false,
				'supports'        => array( 'title', 'editor', 'author' ),
				'menu_icon'       => 'dashicons-format-chat',
				// Only administrators: an editor-based client must not read other clients'
				// requests. New ones only come from the form below.
				'map_meta_cap'    => true,
				'capability_type' => 'client_request',
				'capabilities'    => array( 'create_posts' => 'do_not_allow' ) + $capabilities,
			)
		);
	}
);

add_filter(
	'manage_client_request_posts_columns',
	static function ( array $columns ) {
		return array_slice( $columns, 0, 2 ) + array(
			'client-admin-page' => __( 'Page', 'client-admin' ),
		) + $columns;
	}
);

add_action(
	'manage_client_request_posts_custom_column',
	static function ( string $column, int $post_id ) {
		if ( 'client-admin-page' === $column ) {
			echo esc_html( (string) get_post_meta( $post_id, 'page', true ) );
		}
	},
	10,
	2
);

/**
 * Whether anyone reads requests: only when the manifest names an agency.
 */
function client_admin_accepts_requests(): bool {
	return ! empty( client_admin_manifest()['agency'] );
}

/**
 * Stores a request and emails the agency.
 *
 * @param string $message What the client asks for.
 * @param string $page    The URL they are asking about.
 * @return int|WP_Error The request's ID.
 */
function client_admin_send_request( string $message, string $page ) {
	$message = sanitize_textarea_field( $message );
	if ( '' === trim( $message ) ) {
		return new WP_Error( 'empty_request', __( 'Tell us what you would like changed.', 'client-admin' ) );
	}

	$page    = esc_url_raw( $page, array( 'http', 'https' ) );
	$post_id = wp_insert_post(
		wp_slash(
			array(
				'post_type'    => 'client_request',
				'post_status'  => 'private',
				'post_title'   => wp_html_excerpt( $message, 60, '…' ),
				'post_content' => $message,
				'post_author'  => get_current_user_id(),
				'meta_input'   => array( 'page' => $page ),
			)
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		return $post_id;
	}

	$agency = client_admin_manifest()['agency'] ?? array();
	if ( ! empty( $agency['email'] ) ) {
		$user = wp_get_current_user();
		$body = $page ? "{$message}\n\n{$page}" : $message;
		/* translators: 1: site name, 2: client's name. */
		$subject = sprintf( __( '%1$s: change request from %2$s', 'client-admin' ), get_bloginfo( 'name' ), $user->display_name );
		wp_mail( $agency['email'], $subject, $body, array( "Reply-To: {$user->user_email}" ) );
	}

	return $post_id;
}

// From the editor's sidebar.
add_action(
	'wp_ajax_client_admin_request',
	static function () {
		check_ajax_referer( 'client_admin_request' );
		$result = client_admin_is_curated() && client_admin_accepts_requests()
			? client_admin_send_request( wp_unslash( $_POST['message'] ?? '' ), wp_unslash( $_POST['page'] ?? '' ) )
			: new WP_Error( 'forbidden', __( 'Only clients send requests.', 'client-admin' ) );
		is_wp_error( $result ) ? wp_send_json_error( $result->get_error_message() ) : wp_send_json_success();
	}
);

// From the dashboard widget.
add_action(
	'admin_post_client_admin_request',
	static function () {
		check_admin_referer( 'client_admin_request' );
		if ( client_admin_is_curated() && client_admin_accepts_requests() ) {
			$result = client_admin_send_request( wp_unslash( $_POST['message'] ?? '' ), '' );
		}
		wp_safe_redirect( add_query_arg( 'client-admin-sent', isset( $result ) && ! is_wp_error( $result ) ? '1' : '0', admin_url() ) );
		exit;
	}
);
