---
name: data-persistence
description: The canonical WordPress pattern for forms and user-submitted data on generated sites — a custom post type for the data model, a REST route to accept submissions, and a build-less plain-JS block for the UI, all in the companion plugin. Load when the site needs a contact form, signup, booking, or any data capture.
---

# Data Persistence

Use this skill whenever the site must **persist data a visitor submits through the front end**: a contact form, a booking or reservation, an RSVP, a review or testimonial, a newsletter or lead-capture signup, a quote request — anything whose submissions should land in `wp-admin`.

## Where everything lives

A generated site is two packages:

- The **presentation theme** at `<site>/wp-content/themes/<slug>/` holds only look-and-feel: `theme.json`, `style.css`, `templates/`, `parts/`, `patterns/`, `assets/`. Its `functions.php` is minimal — enqueue `style.css` and `add_editor_style`, nothing more. The theme registers **no** post types, **no** REST routes, **no** blocks, and seeds **no** content.
- The **companion plugin** at `<site>/wp-content/plugins/<slug>-functionality/` holds **all** behavior. Every part of this pattern — the CPT, the post meta, the REST route, and the form block — goes here, never in the theme.

The three parts are always wired together, all inside the companion plugin:

1. **Custom post type (CPT)** — the data model. One post per submission. Registered with `show_in_rest => true`.
2. **REST route** — the bridge. A namespaced `POST` route that sanitizes input and inserts a CPT post.
3. **Build-less plain-JS block** — the UI. A `block.json` plus a plain `view.js` that POSTs the form to the route. No JSX, no `@wordpress/scripts`, no npm build.

Do not substitute parts:

- Do not save submissions to the options table, a transient, or a custom DB table. Use a CPT — it gives you `wp-admin` listing, search, export, and REST for free.
- Do not render the form as a `core/html` block or a raw HTML snippet. Build a real registered block.
- Do not use `admin-ajax.php`. Use the REST API.
- Do not use the Interactivity API for the block. Use plain JS with standard DOM APIs (`fetch`, `addEventListener`).

Content (the sample submissions, and any page that hosts the form) is **seeded into the live WordPress database** via WP-CLI — never baked into the theme as `*.html` files.

## Worked example: contact form

A user asks for "a contact form on the site." Here is the complete wiring. Assume the plugin slug is `acme` and its main file lives at `<site>/wp-content/plugins/acme-functionality/acme-functionality.php`. Split the parts across `includes/` files (`includes/cpt.php`, `includes/rest.php`, `includes/blocks.php`) and `require` them from the main plugin file. See the `companion-plugin` skill for the plugin scaffold and bootstrap.

### 1. Register the CPT and its meta

In `includes/cpt.php` of the companion plugin:

```php
<?php
add_action( 'init', 'acme_register_contact_cpt' );
function acme_register_contact_cpt() {
    register_post_type( 'acme_contact', array(
        'label'           => 'Contact Submissions',
        'labels'          => array(
            'name'          => 'Contact Submissions',
            'singular_name' => 'Contact Submission',
            'menu_name'     => 'Contacts',
        ),
        'public'          => false,
        'show_ui'         => true,
        'show_in_menu'    => true,
        'show_in_rest'    => true,
        'rest_base'       => 'acme-contacts',
        'menu_icon'       => 'dashicons-email',
        'supports'        => array( 'title', 'editor', 'custom-fields' ),
        'capability_type' => 'post',
        'map_meta_cap'    => true,
    ) );

    register_post_meta( 'acme_contact', 'email', array(
        'type'          => 'string',
        'single'        => true,
        'show_in_rest'  => true,
        'auth_callback' => '__return_true',
    ) );
    register_post_meta( 'acme_contact', 'phone', array(
        'type'          => 'string',
        'single'        => true,
        'show_in_rest'  => true,
        'auth_callback' => '__return_true',
    ) );
}
```

Rules:

- Prefix the post-type slug with the plugin slug (`acme_contact`, not `contact`). Slugs are capped at 20 characters.
- `public => false` — submissions are admin-only data, not public single pages.
- `show_ui => true` so submissions show up in `wp-admin`.
- `show_in_rest => true` **always** — it powers both the admin block-editor listing and the auto-created REST collection.
- Use `register_post_meta` for structured fields (email, phone, booking date, party size, rating) so they are queryable, exportable, and visible.
- `supports` should include `'title'` (the submission label) plus `'editor'` and/or `'custom-fields'` as appropriate.

### 2. Register the REST route for submissions

The auto-created `/wp/v2/acme-contacts` collection requires authentication to create posts, so it cannot accept anonymous public form submissions. Add a **custom, namespaced** `POST` route that accepts unauthenticated submissions and sanitizes every field. In `includes/rest.php`:

```php
<?php
add_action( 'rest_api_init', 'acme_register_contact_route' );
function acme_register_contact_route() {
    register_rest_route( 'acme/v1', '/contact', array(
        'methods'             => 'POST',
        'callback'            => 'acme_handle_contact_submission',
        'permission_callback' => '__return_true',
        'args'                => array(
            'name'    => array(
                'required'          => true,
                'type'              => 'string',
                'sanitize_callback' => 'sanitize_text_field',
                'validate_callback' => function ( $value ) {
                    return is_string( $value ) && strlen( $value ) >= 2 && strlen( $value ) <= 100;
                },
            ),
            'email'   => array(
                'required'          => true,
                'type'              => 'string',
                'format'            => 'email',
                'sanitize_callback' => 'sanitize_email',
                'validate_callback' => function ( $value ) {
                    return is_email( $value ) !== false;
                },
            ),
            'message' => array(
                'required'          => true,
                'type'              => 'string',
                'sanitize_callback' => 'sanitize_textarea_field',
            ),
        ),
    ) );
}

function acme_handle_contact_submission( WP_REST_Request $request ) {
    $name    = $request->get_param( 'name' );
    $email   = $request->get_param( 'email' );
    $message = $request->get_param( 'message' );

    $post_id = wp_insert_post( array(
        'post_type'    => 'acme_contact',
        'post_status'  => 'publish',
        'post_title'   => $name . ' — ' . current_time( 'Y-m-d H:i' ),
        'post_content' => $message,
        'meta_input'   => array(
            'email' => $email,
        ),
    ), true );

    if ( is_wp_error( $post_id ) ) {
        return new WP_Error( 'acme_insert_failed', 'Could not save your message.', array( 'status' => 500 ) );
    }

    return new WP_REST_Response( array( 'ok' => true, 'id' => $post_id ), 201 );
}
```

Rules:

- Use a **namespaced** route (`acme/v1/contact`), never a generic name.
- `permission_callback => '__return_true'` is correct for a public form. It is only safe because the `args` schema validates and sanitizes every field. Never skip the schema.
- Let the `args` schema do validation and sanitization. With `required`, `sanitize_callback`, and `validate_callback` set, WordPress rejects missing or malformed input before your callback runs — no manual checks needed in the body.
- Never trust the client. Sanitize every field; `sanitize_email` for emails, `sanitize_text_field` for single-line text, `sanitize_textarea_field` or `wp_kses_post` for bodies.
- Return a `WP_Error` with an HTTP `status` for failures; return a `WP_REST_Response` with `201` on create. Use the standard `rest_*` error-code prefix so clients recognize it.
- Never echo the raw post array back. Return only the canonical, redacted shape (here, `ok` and `id`).
- For higher-abuse endpoints add a honeypot field and/or a transient-based rate limit keyed by IP. See `wp-best-practices` for capability and nonce patterns when the endpoint is **not** public.

### 3. Build the build-less plain-JS block

The form UI is a real registered block in the companion plugin — **build-less plain JS**, no compilation. Files under `<site>/wp-content/plugins/acme-functionality/blocks/contact-form/`:

**`block.json`** — metadata. `render` points at a PHP file (server render); `viewScript` is the front-end behavior; `editorScript` is the editor representation.

```json
{
    "$schema": "https://schemas.wp.org/trunk/block.json",
    "apiVersion": 3,
    "name": "acme/contact-form",
    "title": "Contact Form",
    "category": "widgets",
    "icon": "email",
    "description": "A contact form that saves submissions to wp-admin.",
    "textdomain": "acme",
    "render": "file:./render.php",
    "editorScript": "file:./editor.js",
    "viewScript": "file:./view.js",
    "style": "file:./style.css"
}
```

**`render.php`** — server-rendered HTML, printing the REST endpoint and a nonce as data attributes. Put the custom class only on the outermost wrapper via `get_block_wrapper_attributes`; inner DOM carries no custom classNames.

```php
<?php
$endpoint = esc_url_raw( rest_url( 'acme/v1/contact' ) );
$nonce    = wp_create_nonce( 'wp_rest' );
?>
<form
    <?php echo get_block_wrapper_attributes( array( 'class' => 'acme-contact-form' ) ); ?>
    data-endpoint="<?php echo esc_attr( $endpoint ); ?>"
    data-nonce="<?php echo esc_attr( $nonce ); ?>"
>
    <label>Name<input type="text" name="name" required></label>
    <label>Email<input type="email" name="email" required></label>
    <label>Message<textarea name="message" required></textarea></label>
    <button type="submit">Send</button>
    <p class="acme-contact-form__status" aria-live="polite"></p>
</form>
```

**`editor.js`** — plain JS, no JSX. Register the block with `wp.blocks.registerBlockType` using `wp.element.createElement`. This example deliberately uses **only** `wp.blocks` and `wp.element` — both are always present in the editor before any block editorScript runs, so a build-less `editorScript: "file:./editor.js"` works with no dependency declaration. The editor representation is a static preview; the live `render.php` runs on the front end.

```js
( function ( blocks, element ) {
    var el = element.createElement;

    blocks.registerBlockType( 'acme/contact-form', {
        edit: function () {
            return el(
                'form',
                { className: 'acme-contact-form' },
                el( 'label', null, 'Name', el( 'input', { type: 'text', disabled: true } ) ),
                el( 'label', null, 'Email', el( 'input', { type: 'email', disabled: true } ) ),
                el( 'label', null, 'Message', el( 'textarea', { disabled: true } ) ),
                el( 'button', { type: 'button', disabled: true }, 'Send' )
            );
        },
        save: function () {
            // Dynamic block: rendered by render.php on the server.
            return null;
        },
    } );
} )( window.wp.blocks, window.wp.element );
```

> If an editor component needs `wp.blockEditor` (e.g. `useBlockProps`, `InspectorControls`) or `wp.components`, those globals are **not** guaranteed for a bare `file:` script — register the editor script in PHP with an explicit dependency array (`wp-blocks`, `wp-element`, `wp-block-editor`, `wp-components`, `wp-i18n`) per the recipe in the `companion-plugin` skill.

**`view.js`** — plain JS front-end behavior. Intercept submit, POST JSON to the REST route, show success and error states. Standard DOM APIs only — no Interactivity API.

```js
document.querySelectorAll( '.acme-contact-form' ).forEach( function ( form ) {
    form.addEventListener( 'submit', function ( event ) {
        event.preventDefault();
        var status = form.querySelector( '.acme-contact-form__status' );
        var body = {};
        new FormData( form ).forEach( function ( value, key ) {
            body[ key ] = value;
        } );
        status.textContent = 'Sending…';
        fetch( form.dataset.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': form.dataset.nonce,
            },
            body: JSON.stringify( body ),
        } )
            .then( function ( response ) {
                return response.json().then( function ( data ) {
                    if ( ! response.ok ) {
                        throw new Error( data && data.message ? data.message : 'Submission failed.' );
                    }
                    return data;
                } );
            } )
            .then( function () {
                form.reset();
                status.textContent = 'Thanks! We will be in touch.';
            } )
            .catch( function ( error ) {
                status.textContent = error.message;
            } );
    } );
} );
```

The `X-WP-Nonce` header ties the request into WordPress's standard REST request handling (and, for a logged-in user, identifies the current user; for an anonymous visitor the nonce is generated for user 0 and is not by itself authenticating). The route still allows anonymous submissions (`permission_callback => '__return_true'`), but sending the nonce keeps the request on the normal REST path and lets you tighten the permission callback later without changing the block.

### 4. Register the block server-side

Register from the block directory in `includes/blocks.php`. Because `block.json` names `view.js`/`editor.js` as files, WordPress enqueues them automatically — there is no build directory.

```php
<?php
add_action( 'init', 'acme_register_blocks' );
function acme_register_blocks() {
    register_block_type( plugin_dir_path( __DIR__ ) . 'blocks/contact-form' );
}
```

### 5. Put the block on a page in the live DB

If the site has a dedicated Contact page, the form block belongs in that page's content. Do **not** write a `content/*.html` file. Seed the page into the running database with WP-CLI, with the block delimiter inline:

```bash
wp post create \
  --post_type=page \
  --post_status=publish \
  --post_title='Contact' \
  --post_content='<!-- wp:acme/contact-form /-->' \
  --path=<site>
```

### 6. Seed sample submissions into the live DB

A submission CPT with an empty `wp-admin` list reads as broken — the owner opens "Contacts," sees nothing, and the data model, meta fields, and workflow are invisible. Seed **2–3 fictional submissions into the live database** so the admin experience is tangible immediately. Seeding bypasses the REST route (it runs trusted, server-side) and is done with WP-CLI, not from theme code.

Rules:

- Seed with WP-CLI against the running site, not from `init` (which runs every request) and not from a theme activation hook.
- **Idempotent by meta.** Guard each insert with a meta key unique to the seed (e.g. `_acme_seed_id => 'contact-1'`), not by title — titles collide with real submissions. Re-running the seed must not duplicate.
- Fill **every** `register_post_meta` field with realistic values so the data shape is visible.
- Use varied `post_date` values across the last 30 days — submissions all dated "today" look fake.
- Submissions are **fictional**: invented names, `@example.com` emails, invented phone numbers. Never real brands or real people.

A small seeding script, run with `wp eval-file <file> --path=<site>`:

```php
<?php
$samples = array(
    array(
        'seed_id'  => 'contact-1',
        'name'     => 'Jordan Lee',
        'email'    => 'jordan@example.com',
        'phone'    => '+1 555 0100',
        'message'  => 'We are planning a launch event in the autumn and would love to discuss catering for around 40 guests.',
        'days_ago' => 2,
    ),
    array(
        'seed_id'  => 'contact-2',
        'name'     => 'Priya Rao',
        'email'    => 'priya@example.com',
        'phone'    => '+44 20 7946 0000',
        'message'  => 'Quick question about your tasting menu — can you accommodate a nut allergy?',
        'days_ago' => 6,
    ),
    array(
        'seed_id'  => 'contact-3',
        'name'     => 'Marcus Chen',
        'email'    => 'marcus@example.com',
        'phone'    => '+1 555 0142',
        'message'  => 'Looking to book the private dining room for a work offsite in November. Availability?',
        'days_ago' => 14,
    ),
);

foreach ( $samples as $s ) {
    $existing = get_posts( array(
        'post_type'      => 'acme_contact',
        'post_status'    => 'any',
        'meta_key'       => '_acme_seed_id',
        'meta_value'     => $s['seed_id'],
        'posts_per_page' => 1,
        'fields'         => 'ids',
    ) );
    if ( $existing ) {
        continue;
    }
    $when = strtotime( '-' . $s['days_ago'] . ' days' );
    wp_insert_post( array(
        'post_type'    => 'acme_contact',
        'post_status'  => 'publish',
        'post_title'   => $s['name'] . ' — ' . wp_date( 'Y-m-d H:i', $when ),
        'post_content' => $s['message'],
        'post_date'    => wp_date( 'Y-m-d H:i:s', $when ),
        'meta_input'   => array(
            'email'         => $s['email'],
            'phone'         => $s['phone'],
            '_acme_seed_id' => $s['seed_id'],
        ),
    ) );
}
```

The companion plugin must be active before seeding so the CPT and its meta are registered. Apply the same shape to `_booking`, `_rsvp`, `_review`, `_subscriber`, etc.

## Shape of the data for common features

| Feature | CPT slug | Key meta fields |
|---|---|---|
| Contact form | `acme_contact` | `email`, `phone` |
| Booking / reservation | `acme_booking` | `booking_date`, `booking_time`, `party_size`, `email`, `phone` |
| RSVP | `acme_rsvp` | `event_id`, `attending`, `guests`, `email` |
| Review / testimonial | `acme_review` | `rating`, `reviewer_name`, `approved` |
| Newsletter signup | `acme_subscriber` | `email`, `source`, `consent_at` |

For each, wire the same three parts in the companion plugin: CPT with `show_in_rest => true`, a build-less plain-JS form block, and a namespaced REST `POST` route with a validated `args` schema. Then seed 2–3 fictional rows into the live DB.

## REST endpoint depth

The pattern above gets data flowing. These rules make the endpoint production-safe.

### Permission callbacks beyond public

A public submission form uses `__return_true` plus a strict `args` schema. Any endpoint that reads or mutates existing data must check a real capability and verify the nonce:

```php
'permission_callback' => function ( WP_REST_Request $request ) {
    if ( ! wp_verify_nonce( $request->get_header( 'X-WP-Nonce' ), 'wp_rest' ) ) {
        return new WP_Error( 'rest_forbidden', 'Nonce verification failed.', array( 'status' => 401 ) );
    }
    if ( ! current_user_can( 'edit_posts' ) ) {
        return new WP_Error( 'rest_forbidden', 'You cannot do this.', array( 'status' => 403 ) );
    }
    return true;
},
```

### Expose CPT meta as first-class REST fields

To read or update meta through REST with a schema and an `enum`:

```php
add_action( 'rest_api_init', function () {
    register_rest_field( 'acme_contact', 'status', array(
        'get_callback'    => function ( $object ) {
            return get_post_meta( $object['id'], '_acme_status', true ) ?: 'new';
        },
        'update_callback' => function ( $value, $object ) {
            return (bool) update_post_meta( $object->ID, '_acme_status', sanitize_text_field( $value ) );
        },
        'schema'          => array(
            'type'    => 'string',
            'enum'    => array( 'new', 'reviewed', 'archived' ),
            'context' => array( 'view', 'edit' ),
        ),
    ) );
} );
```

### Status-code-correct error responses

Use the standard `rest_*` codes; clients and the block editor recognize them.

```php
return new WP_Error( 'rest_invalid_param', 'Invalid email address.', array( 'status' => 400 ) );
return new WP_Error( 'rest_forbidden',     'You cannot do this.',    array( 'status' => 403 ) );
return new WP_Error( 'rest_not_found',     'Submission not found.',  array( 'status' => 404 ) );
```

### Do not leak drafts or private posts

A custom read endpoint using `get_posts()` must honor visibility:

```php
$args = array(
    'post_type'   => 'acme_contact',
    'post_status' => current_user_can( 'edit_others_posts' )
        ? array( 'publish', 'draft', 'private' )
        : 'publish',
);
```

## Checklist

Before treating a data-persistence feature as complete, verify all of it lives in the companion plugin and:

- [ ] CPT registered with a plugin-prefixed slug and `show_in_rest => true`, visible in `wp-admin`.
- [ ] Structured fields registered via `register_post_meta` with `show_in_rest => true`.
- [ ] Custom REST route is namespaced (`acme/v1/...`) and validates and sanitizes every field via an `args` schema.
- [ ] Public submit route uses `__return_true` only because the `args` schema is strict; non-public routes check capability and nonce.
- [ ] The form UI is a real registered block — build-less plain JS (`registerBlockType` via `wp.element.createElement`, no JSX, no build), not `core/html`, not raw HTML.
- [ ] Custom class only on the outer wrapper via `get_block_wrapper_attributes`; no custom classNames on inner DOM. No emojis. No decorative HTML comments.
- [ ] `view.js` uses standard DOM APIs and `fetch` (never the Interactivity API), POSTs JSON with `Content-Type: application/json` and an `X-WP-Nonce` header.
- [ ] Success and error states are shown to the visitor via an `aria-live` region.
- [ ] Block registered server-side with `register_block_type` pointing at the block directory.
- [ ] If the feature has a dedicated page, the page is created in the live DB via WP-CLI with the block delimiter inline — not as a theme `*.html` file.
- [ ] 2–3 fictional submissions seeded into the live DB via WP-CLI, idempotent by a `_acme_seed_id` meta key, covering every meta field with realistic values and varied `post_date`s.

## Related skills

- `companion-plugin` — the plugin scaffold, bootstrap, and how to split behavior across `includes/`; this is where the CPT, REST route, and block files belong.
- `wp-best-practices` — sanitization and escaping, nonce and capability checks, REST schema conventions, and build-less plain-JS block conventions.
