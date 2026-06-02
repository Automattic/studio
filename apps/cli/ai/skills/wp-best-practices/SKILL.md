---
name: wp-best-practices
description: WordPress code-quality rules for generated PHP — output escaping, input sanitization, nonces and capability checks, performance, and type safety. Load before writing or reviewing companion-plugin PHP.
---

# WordPress Code Quality Rules

Every line of PHP you write for a generated site MUST follow the rules below. These are not stylistic preferences — they are correctness, security, and performance constraints that protect the people who will run the generated site. Violating any rule is a defect, not a nitpick.

## Where this applies

A generated site is two packages:

- A **pure presentation theme** at `<site>/wp-content/themes/<slug>/`. Its `functions.php` is minimal — only enqueue `style.css` on the front end and call `add_editor_style`. It has no custom post types, no REST routes, no block registration, and no content seeding. There is almost no security-sensitive PHP here.
- A **companion plugin** at `<site>/wp-content/plugins/<slug>-functionality/`. ALL behavior lives here: custom post types, taxonomies, post meta, REST API routes, and custom Gutenberg blocks (build-less plain JS registered server-side with `register_block_type`). **This is where every rule below earns its keep.** If you are writing PHP that touches `$_POST`, the database, a REST request, or user capabilities, you are in the companion plugin and these rules are mandatory.

Content is seeded into the live WordPress database via WP-CLI / the seed-content tool — never baked into theme files. So "input" below means input arriving at a live request (form posts, REST bodies, query args), not build-time data.

When the rules below mention `<slug>` or `'textdomain'`, substitute the site's actual slug. The theme text domain is the theme slug; the plugin text domain is `<slug>-functionality` (or whatever the plugin header declares).

---

## Security rules

### 1. Escape every output

Choose the escape function by **output context**, not by what feels safe. The same value escaped for HTML text is not safe inside an attribute or a URL.

```php
echo esc_html( $title );          // text between HTML tags
echo esc_attr( $value );          // values inside an attribute
echo esc_url( $href );            // URLs in href / src / action
echo wp_kses_post( $rich_html );  // post-content HTML (allows <a>, <strong>, <em>, etc.)
echo esc_js( $js_string );        // strings injected into inline JS
echo esc_textarea( $multiline );  // textarea content
```

Never echo a variable directly. Even data you "control" (an option you set, a post title) can be changed by another plugin, another admin, or a future you.

```php
// WRONG
echo '<h2 class="event-title">' . $title . '</h2>';
echo '<a href="' . $cta_url . '">' . $cta_label . '</a>';

// RIGHT
printf(
    '<h2 class="event-title">%s</h2>',
    esc_html( $title )
);
printf(
    '<a href="%s">%s</a>',
    esc_url( $cta_url ),
    esc_html( $cta_label )
);
```

When you output a translated string, escape the **result** of the translation, not the literal:

```php
echo esc_html__( 'Submit', 'textdomain' );   // returns the escaped, translated string
esc_html_e( 'Submit', 'textdomain' );          // echoes it directly
```

In a block `render_callback` (the typical companion-plugin block), the same rule holds — every interpolated attribute or meta value passes through an `esc_*` function before it reaches the markup string you return.

### 2. Sanitize every input

Sanitize on the way in, with the function that matches the data type. Never trust `$_POST`, `$_GET`, `$_REQUEST`, `$_COOKIE`, or `$_SERVER` directly.

```php
$title   = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
$email   = sanitize_email( wp_unslash( $_POST['email'] ?? '' ) );
$content = wp_kses_post( wp_unslash( $_POST['content'] ?? '' ) ); // rich HTML, strips disallowed tags
$count   = absint( $_POST['count'] ?? 0 );
$slug    = sanitize_title( wp_unslash( $_POST['slug'] ?? '' ) );  // URL slugs only — lossy on prose
$key     = sanitize_key( wp_unslash( $_POST['key'] ?? '' ) );
$file    = sanitize_file_name( wp_unslash( $_POST['file'] ?? '' ) );
$url     = esc_url_raw( wp_unslash( $_POST['url'] ?? '' ) );      // sanitize-for-storage variant of esc_url
$int     = (int) ( $_POST['qty'] ?? 0 );
```

`wp_unslash` first (WordPress adds slashes to superglobals), then sanitize. Use `?? ''` / `?? 0` so a missing key never becomes a PHP warning.

Notes:
- `wp_kses_post` is both a sanitizer and an escaper for post-content HTML. Content stored after `wp_kses_post` is safe to echo directly **only in post-content context**. Put that same value in an attribute or URL and you still need `esc_attr` / `esc_url`.
- `sanitize_text_field` collapses whitespace and strips tags — wrong for multi-line input; use `sanitize_textarea_field` for that.

```php
// WRONG — trusts raw input, no unslash
$name = $_POST['name'];
update_post_meta( $post_id, '_attendee_name', $name );

// RIGHT
$name = sanitize_text_field( wp_unslash( $_POST['name'] ?? '' ) );
update_post_meta( $post_id, '_attendee_name', $name );
```

### 3. Nonce AND capability on every state change — in the same callback

Every form submission and every REST write endpoint MUST verify a nonce **and** check a capability, **in the same callback**. Splitting them across functions invites an endpoint that has one check but not the other. A nonce proves the request came from your UI; a capability proves the user is allowed to do it. You need both.

```php
// Admin form / AJAX handler
function handle_rsvp_submit(): void {
    if (
        ! isset( $_POST['rsvp_nonce'] )
        || ! wp_verify_nonce( sanitize_key( $_POST['rsvp_nonce'] ), 'rsvp_action' )
    ) {
        wp_die( esc_html__( 'Security check failed.', 'textdomain' ) );
    }
    if ( ! current_user_can( 'edit_posts' ) ) {
        wp_die( esc_html__( 'You are not allowed to do this.', 'textdomain' ) );
    }
    // ...mutate state...
}
```

Emit the nonce field in the form with `wp_nonce_field( 'rsvp_action', 'rsvp_nonce' )`.

For REST endpoints the `permission_callback` is where this lives:

```php
// WRONG — write endpoint with no permission gate. This is publicly writable.
register_rest_route( '<slug>/v1', '/rsvp', [
    'methods'  => 'POST',
    'callback' => 'create_rsvp',
    // missing permission_callback entirely
] );

// WRONG — never do this; it disables the gate.
'permission_callback' => '__return_true',  // only acceptable for genuinely public READ endpoints
```

```php
// RIGHT — nonce + capability, returning WP_Error so the client learns what failed.
register_rest_route( '<slug>/v1', '/rsvp', [
    'methods'             => WP_REST_Server::CREATABLE, // 'POST'
    'callback'            => 'create_rsvp',
    'permission_callback' => 'rsvp_can_create',
    'args'                => [
        'event_id' => [
            'type'              => 'integer',
            'required'          => true,
            'sanitize_callback' => 'absint',
        ],
        'email' => [
            'type'              => 'string',
            'required'          => true,
            'sanitize_callback' => 'sanitize_email',
            'validate_callback' => static fn( $v ): bool => is_email( $v ) !== false,
        ],
    ],
] );

function rsvp_can_create( WP_REST_Request $request ): bool|WP_Error {
    if ( ! wp_verify_nonce( (string) $request->get_header( 'X-WP-Nonce' ), 'wp_rest' ) ) {
        return new WP_Error(
            'rest_forbidden',
            __( 'Nonce verification failed.', 'textdomain' ),
            [ 'status' => 401 ]
        );
    }
    if ( ! current_user_can( 'edit_posts' ) ) {
        return new WP_Error(
            'rest_forbidden',
            __( 'You are not allowed to do this.', 'textdomain' ),
            [ 'status' => 403 ]
        );
    }
    return true;
}
```

### 4. REST `permission_callback` discipline

- Every `register_rest_route` call MUST include a `permission_callback`. Omitting it triggers a `_doing_it_wrong()` notice and, worse, leaves the route ungated.
- Read-only public endpoints (e.g. a list of published events) may use `'__return_true'` — but only after you confirm the data is genuinely public. Default to a real check.
- Return `bool|WP_Error`, never a bare `false`. WordPress turns bare `false` into a generic 403 with no message; the client has no signal about *what* failed (not logged in? wrong role? bad nonce?). A `WP_Error` carries a code, a message, and a status.
- Validate and sanitize per-argument via the `args` schema (`sanitize_callback`, `validate_callback`, `required`, `type`). This runs before your callback, so the callback receives clean data.
- The capability in `permission_callback` MUST match the capability your editor/UI uses to decide whether to show the control — otherwise the button appears, the user clicks, and the request fails.

### 5. Use prepared statements

If you ever touch `$wpdb` directly (most companion plugins should prefer `WP_Query`, `get_posts`, `get_post_meta`, and the REST/CPT APIs), never concatenate input into SQL.

```php
// WRONG
$wpdb->query( "SELECT * FROM {$wpdb->posts} WHERE ID = $id" );

// RIGHT
$rows = $wpdb->get_results(
    $wpdb->prepare(
        "SELECT ID, post_title FROM {$wpdb->posts} WHERE post_author = %d AND post_status = %s",
        $author_id,
        'publish'
    )
);
```

`%d` for integers, `%s` for strings, `%f` for floats. Table names come from `$wpdb` properties, not from input.

### 6. Prefer the Abilities API for recurring permission boundaries

When the same capability check appears in more than one place, needs to be auditable, REST-discoverable (so the editor can ask "can I do this?" before showing UI), or finer-grained than built-in caps, register a named **Ability** instead of scattering `current_user_can()` calls.

Hook order is strict: register **categories** on `wp_abilities_api_categories_init`, then **abilities** on `wp_abilities_api_init`. Registering an ability outside `wp_abilities_api_init` triggers `_doing_it_wrong()` and silently fails.

```php
add_action( 'wp_abilities_api_categories_init', static function (): void {
    wp_register_ability_category( '<slug>', [
        'label' => __( 'Site Features', 'textdomain' ),
    ] );
} );

add_action( 'wp_abilities_api_init', static function (): void {
    wp_register_ability( '<slug>/publish-event', [
        'label'               => __( 'Publish Event', 'textdomain' ),
        'description'         => __( 'Publishes a draft event.', 'textdomain' ),
        'category'            => '<slug>',
        'execute_callback'    => static function ( array $args ): array {
            $id = wp_update_post( [ 'ID' => (int) $args['id'], 'post_status' => 'publish' ], true );
            return [ 'published' => ! is_wp_error( $id ) ];
        },
        // bool|WP_Error — required for anything that mutates data.
        'permission_callback' => static function (): bool|WP_Error {
            if ( ! current_user_can( 'publish_posts' ) ) {
                return new WP_Error( 'rest_forbidden', __( 'You cannot publish.', 'textdomain' ), [ 'status' => 403 ] );
            }
            return true;
        },
        'input_schema'        => [
            'type'       => 'object',
            'properties' => [ 'id' => [ 'type' => 'integer' ] ],
            'required'   => [ 'id' ],
        ],
        'meta'                => [ 'show_in_rest' => true ],
    ] );
} );
```

Abilities with `meta.show_in_rest => true` appear under `/wp-json/wp-abilities/v1/abilities`. The REST layer applies `permission_callback` automatically — if the editor's `getAbility( name )` returns `undefined`, the user cannot run it, so the UI stays in sync with permissions. The Abilities API ships in WordPress 6.9+; for earlier targets, feature-detect before registering. Abilities **complement** sanitization and escaping — they do not replace either. For one-off gates with no UI implications, a plain `current_user_can()` check is fine.

---

## Performance rules

### 1. Never autoload large options

Options with autoload on are loaded into memory on **every** request. The default autoloads, which is the wrong default for anything bigger than a few hundred bytes. Pass `false` to keep it out of the autoload set (the old `'yes'`/`'no'` string forms are deprecated as of WP 6.6).

```php
// WRONG — a multi-KB blob loaded on every page view, forever
add_option( 'mysite_event_cache', $big_array );

// RIGHT — third arg is the deprecated $deprecated (always ''), fourth is autoload.
add_option( 'mysite_event_cache', $big_array, '', false );
update_option( 'mysite_event_cache', $big_array, false );
```

Rule of thumb: autoload only options under ~1 KB that are genuinely read on every page load. Plugin settings that are small and read everywhere can autoload; caches, logs, and serialized blobs must not.

### 2. Cache expensive operations with transients

Wrap slow queries, external API calls, and computed values in a transient.

```php
$key   = 'mysite_upcoming_events';
$value = get_transient( $key );

if ( false === $value ) {
    $value = compute_upcoming_events(); // DB-heavy query, REST call, etc.
    set_transient( $key, $value, HOUR_IN_SECONDS );
}
```

Invalidate on the relevant hooks (`save_post`, `deleted_post`, `wp_update_user`) — `delete_transient( $key )` — rather than relying on the TTL alone for correctness.

### 3. Bound every WP_Query

Never use `'posts_per_page' => -1` on data that can grow without limit (this is the most common cause of memory-exhaustion crashes on generated sites). Set an explicit bound. Disable the counters and caches you do not use — but **only** disable the meta/term caches if the loop body never calls `get_post_meta()` / `get_the_terms()`, because disabling them and then calling those functions per-row produces N+1 queries that are worse than the default.

```php
$query = new WP_Query( [
    'post_type'              => 'event',
    'post_status'            => 'publish',
    'posts_per_page'         => 12,      // explicit bound, never -1 on unbounded data
    'no_found_rows'          => true,    // skip SQL_CALC_FOUND_ROWS when you don't paginate
    'update_post_meta_cache' => false,   // ONLY if the loop body never calls get_post_meta()
    'update_post_term_cache' => false,   // ONLY if the loop body never calls get_the_terms()
    'fields'                 => 'ids',   // when you only need IDs
] );
```

If you *do* read meta in the loop, leave `update_post_meta_cache` at its default (`true`) so WordPress batch-primes the cache in one query.

### 4. Never run a query inside the loop

Pre-fetch everything before `while ( $query->have_posts() )`, or rely on the primed caches above. A query per iteration is an N+1 problem.

```php
// WRONG — one extra query per post
while ( $query->have_posts() ) {
    $query->the_post();
    $author = get_userdata( get_the_author_meta( 'ID' ) ); // queried every iteration
}

// RIGHT — gather IDs first, fetch authors in one pass, look up from the map.
```

### 5. HTTP calls: timeout, check, fail safely, cache

Never use `file_get_contents()` for remote URLs. Use `wp_remote_get()` / `wp_remote_post()` with an explicit timeout, check for errors, and degrade gracefully — a remote failure must never break the page.

```php
$response = wp_remote_get( $url, [
    'timeout'   => 10,
    'sslverify' => true,
] );

if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
    return $fallback; // never let a third party take the page down
}

$body = json_decode( wp_remote_retrieve_body( $response ), true );
```

Cache the result in a transient so you are not hitting the remote on every request.

---

## Type safety rules

### 1. Type every signature

Parameter types **and** a return type on every function and method. `void` for functions that return nothing; `?Type` for nullable.

```php
public function create_attendee( int $event_id, string $email, ?string $name = null ): int|WP_Error {
    // ...
}

private function flush_cache(): void {
    delete_transient( 'mysite_upcoming_events' );
}
```

### 2. PHPDoc array shapes

A bare `array` tells the reader nothing. Document the shape with array-shape syntax.

```php
/**
 * @param array{id: int, label: string, items: array<int, string>} $config
 * @return array<int, WP_Post>
 */
public function build( array $config ): array {
    // ...
}
```

### 3. Avoid `mixed`

If you reach for `mixed`, the function is usually doing two things at once. Split it or narrow the type. Reserve `mixed` for genuine pass-through (e.g. a generic cache getter) and even then document the real shapes in PHPDoc.

### 4. JavaScript (build-less block view/editor scripts): typed JSDoc on exports

Custom blocks live in the companion plugin as plain-JS `view.js` / `editor.js` that call `wp.blocks.registerBlockType` via `wp.element.createElement` (no JSX, no `@wordpress/scripts`, no build step, never the Interactivity API — plain JS and standard DOM APIs only). Annotate exported and shared functions with JSDoc.

```javascript
/**
 * @param {string} name
 * @param {{count: number, items: string[]}} options
 * @returns {Promise<boolean>}
 */
function register( name, options ) {
    // ...
}
```

---

## Pre-ship checklist

- [ ] Every output passes through an `esc_*` / `wp_kses_*` function chosen for its context.
- [ ] Every input passes through `wp_unslash` then a `sanitize_*` / `wp_kses_*` function.
- [ ] Every form and every REST/AJAX write verifies a nonce **and** a capability in the same callback.
- [ ] Every `register_rest_route` has a real `permission_callback` returning `bool|WP_Error` (not bare `false`, not a stray `__return_true` on a write route).
- [ ] No `$wpdb` query without `$wpdb->prepare()` for any interpolated value.
- [ ] No `add_option()` / `update_option()` autoloading anything larger than a few hundred bytes.
- [ ] No `'posts_per_page' => -1` on unbounded data; queries are bounded and unused caches disabled only when safe.
- [ ] No `file_get_contents()` for HTTP — `wp_remote_get()` with timeout, error check, fallback, and a transient.
- [ ] Every function signature has parameter types and a return type; array params/returns have PHPDoc shapes.
- [ ] No `mixed` unless genuinely unavoidable and documented.
