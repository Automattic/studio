<?php
/**
 * Post-install setup for the Wedding RSVP blueprint.
 */

defined( 'ABSPATH' ) || exit;

wp_set_current_user( 1 );

update_option( 'blogname', 'Emma & James' );
update_option( 'blogdescription', '' );
update_option( 'jetpack_offline_mode', true );

// Force-enable Jetpack modules via option
$active_modules = get_option( 'jetpack_active_modules', array() );
foreach ( array( 'blocks', 'contact-form' ) as $mod ) {
	if ( ! in_array( $mod, $active_modules, true ) ) {
		$active_modules[] = $mod;
	}
}
update_option( 'jetpack_active_modules', $active_modules );

if ( class_exists( 'Jetpack' ) ) {
	Jetpack::activate_module( 'blocks', false, false );
	Jetpack::activate_module( 'contact-form', false, false );
}

if ( class_exists( 'Jetpack_Options' ) ) {
	Jetpack_Options::update_option( 'dismissed_recommendations', true );
	Jetpack_Options::update_option( 'recommendations_first_run', false );
	Jetpack_Options::update_option( 'dismissed_welcome_banner', true );
}

// Delete default posts and pages
$default_posts = get_posts( array( 'post_type' => array( 'post', 'page' ), 'numberposts' => -1 ) );
foreach ( $default_posts as $p ) {
	wp_delete_post( $p->ID, true );
}

// --- RSVP PAGE ---
$rsvp_content = <<<'HTML'
<!-- wp:heading {"textAlign":"center","level":1,"style":{"typography":{"fontStyle":"italic","fontWeight":"300","fontSize":"2.5rem","letterSpacing":"0.03em"},"spacing":{"margin":{"bottom":"var:preset|spacing|40"}}}} -->
<h1 class="wp-block-heading has-text-align-center" style="font-size:2.5rem;font-style:italic;font-weight:300;letter-spacing:0.03em;margin-bottom:var(--wp--preset--spacing--40)">RSVP</h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">We would be honored by your presence at our wedding.<br>September 20, 2025 · Napa Valley, California</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"0.9rem"}}} -->
<p class="has-text-align-center" style="font-size:0.9rem">Please respond by August 1, 2025.</p>
<!-- /wp:paragraph -->

<!-- wp:spacer {"height":"20px"} -->
<div style="height:20px" aria-hidden="true" class="wp-block-spacer"></div>
<!-- /wp:spacer -->

<!-- wp:jetpack/contact-form {"subject":"Wedding RSVP Response","customThankyou":"message","customThankyouMessage":"Thank you for your RSVP! We can't wait to celebrate with you."} -->
<div class="wp-block-jetpack-contact-form">
	<!-- wp:jetpack/field-name {"required":true,"label":"Your Name"} /-->
	<!-- wp:jetpack/field-email {"required":true,"label":"Email Address"} /-->
	<!-- wp:jetpack/field-radio {"label":"Will you attend?","required":true,"options":["Joyfully accepts","Respectfully declines"]} /-->
	<!-- wp:jetpack/field-text {"label":"Number of Guests"} /-->
	<!-- wp:jetpack/field-select {"label":"Meal Preference","options":["Beef","Chicken","Fish","Vegetarian"]} /-->
	<!-- wp:jetpack/field-textarea {"label":"Dietary Restrictions or Notes"} /-->
	<!-- wp:button {"tagName":"button","type":"submit"} -->
	<div class="wp-block-button"><button type="submit" class="wp-block-button__link wp-element-button">Send RSVP</button></div>
	<!-- /wp:button -->
</div>
<!-- /wp:jetpack/contact-form -->
HTML;

$rsvp_id = wp_insert_post(
	array(
		'post_title'     => 'RSVP',
		'post_name'      => 'rsvp',
		'post_status'    => 'publish',
		'post_type'      => 'page',
		'post_content'   => $rsvp_content,
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
	)
);

if ( is_wp_error( $rsvp_id ) || ! $rsvp_id ) {
	throw new RuntimeException( 'Could not create the RSVP page.' );
}

// --- HOME PAGE (empty, Impressionist renders site title over painting) ---
$home_id = wp_insert_post(
	array(
		'post_title'     => 'Home',
		'post_name'      => 'home',
		'post_status'    => 'publish',
		'post_type'      => 'page',
		'post_content'   => '',
		'comment_status' => 'closed',
		'ping_status'    => 'closed',
	)
);

update_option( 'show_on_front', 'page' );
update_option( 'page_on_front', (int) $home_id );
update_option( 'page_for_posts', 0 );

// Clean up
include_once ABSPATH . 'wp-admin/includes/plugin.php';
include_once ABSPATH . 'wp-admin/includes/file.php';
deactivate_plugins( array( 'hello.php' ) );
delete_plugins( array( 'hello.php' ) );

flush_rewrite_rules();
