---
name: companion-plugin
description: The WordPress companion plugin for generated sites — where all behavior lives: custom post types, taxonomies, post meta, REST routes, and build-less plain-JS Gutenberg blocks. Load before generating any site behavior or custom blocks.
---

# Companion Plugin

A generated WordPress site is always **two packages**:

1. A **pure presentation theme** — `theme.json`, `style.css`, `templates/`, `parts/`, `patterns/`, `assets/`. It declares fonts, colors, spacing, and layout. Its `functions.php` is minimal: enqueue `style.css` on the front end and `add_editor_style`. Nothing else. No custom post types, no REST routes, no block registration, no content seeding.
2. A **companion plugin** — everything that is *behavior*: custom post types, taxonomies, post meta, REST API routes, and custom Gutenberg blocks.

This skill is the runbook for the companion plugin. The rule is absolute: **if it is behavior, it goes in the plugin, not the theme.** A theme that registers a CPT or a REST route is a defect. A plugin that ships `theme.json` or templates is a defect.

You write real files to disk. The theme lives at `<site>/wp-content/themes/<slug>/`. The plugin lives at `<site>/wp-content/plugins/<slug>-functionality/`. Content (pages, posts, CPT entries, sample submissions) is **seeded into the live WordPress database** via WP-CLI / the `seed_content` tool — never baked into either package as content files. You write PHP, JS, and JSON files exactly as a human plugin developer would, and you seed the database directly.

## When the companion plugin is needed at all

Not every site needs a companion plugin. Decide before scaffolding:

- **No plugin** — a purely editorial/marketing site whose every section is core blocks (hero, testimonials, features, pricing, team, FAQ, gallery, CTA). No forms, no custom data, no interactive widgets. Ship only the theme; seed pages/posts into the DB.
- **Plugin required** — the site needs *any* of:
  - A **custom post type** beyond `post`/`page` (events, menu items, properties, team members displayed as a structured archive).
  - A **form that persists** (contact, booking, reservation, RSVP, review, newsletter, lead capture).
  - A **custom Gutenberg block** for project-specific interactivity or data that core blocks plus recommended plugins cannot provide (see [Custom block: warranted or not](#custom-block-warranted-or-not)).
  - A **REST route** the front end calls.

When in doubt, prefer core blocks and skip the plugin. A plugin is overhead the site owner has to maintain; only create one when behavior genuinely lives outside the theme's presentational scope.

## Plugin file structure

Lay the plugin out under `<site>/wp-content/plugins/<slug>-functionality/`. The directory name and main file share the slug. Pick one canonical prefix for the whole plugin (call it `PREFIX` below — e.g. `acme`) and use it consistently for the text domain, function names, hooks, option keys, REST namespace, and block names.

```
<slug>-functionality/
    <slug>-functionality.php      ← main plugin file (header + bootstrap)
    inc/
        post-types.php            ← register_post_type + register_post_meta + register_taxonomy
        rest.php                  ← register_rest_route handlers
    blocks/
        <block-slug>/
            block.json            ← apiVersion 3 metadata
            render.php            ← server render (dynamic blocks)
            editor.js             ← editor component (plain JS, no JSX)
            view.js               ← front-end behavior (plain JS, no JSX)
            style.css             ← shared front-end + editor styles
            editor.css            ← editor-only styles (optional)
```

There is **no `src/` and no `build/` directory** and **no `package.json`**. Blocks are build-less: the JS you write is the JS that ships. `block.json` paths point at the plain files you authored, in place. Do not chain `wp-scripts build`; do not invent a compile step.

### Main file header and bootstrap

The main file carries the standard plugin header docblock and requires the `inc/` files. Keep it thin.

```php
<?php
/**
 * Plugin Name:       Acme Functionality
 * Description:       Behavior for the Acme site — custom post types, REST routes, and blocks.
 * Version:           1.0.0
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Text Domain:       acme
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

require_once __DIR__ . '/inc/post-types.php';
require_once __DIR__ . '/inc/rest.php';

/**
 * Register every custom block from its own directory.
 */
add_action( 'init', static function (): void {
    foreach ( array( 'menu-filter', 'reservation-form' ) as $block ) {
        register_block_type( __DIR__ . '/blocks/' . $block );
    }
} );
```

`register_block_type( __DIR__ . '/blocks/<slug>' )` points at the directory containing the **authored** `block.json` — there is no build output to point at. WordPress reads `block.json` and resolves `editorScript`, `viewScript`, `style`, `editorStyle`, and `render` paths relative to that directory.

## Custom post types, taxonomies, and meta

Register everything on `init` at default priority. Always set `show_in_rest => true` — it powers the block editor and is what lets block bindings and REST reads see the data.

### CPT kinds

There are two kinds, with different argument shapes:

- **Content CPT** (public, displayed on the site — events, products, team, properties):
  - `public => true`, `has_archive => '<slug-without-prefix>'`, `show_in_rest => true`
  - `supports` includes `'title'`, `'editor'`, `'custom-fields'`, `'thumbnail'`
  - Entries are **seeded into the DB**, not authored as files. The theme's archive/single templates render the entries.
- **Submission CPT** (admin-only data captured from a front-end form — contacts, bookings, reviews):
  - `public => false`, `show_ui => true`, `show_in_menu => true`, `show_in_rest => true`
  - `supports` includes `'title'`, `'editor'`, `'custom-fields'`
  - Real submissions arrive via a REST route (below). Seed 2-3 plausible historical entries into the DB so the `wp-admin` list is never empty.

Prefix every CPT slug with the plugin prefix: `acme_event`, `acme_reservation` — never bare `event` or `reservation`.

### register_post_meta with the right sanitiser

Every structured field on a CPT (price, allergens, booking date, party size, rating, email, phone) gets a `register_post_meta` call in the same `init` callback, right after `register_post_type`. `show_in_rest => true` is mandatory — without it, the block editor and any `core/post-meta` binding read nothing.

```php
register_post_meta( 'acme_event', 'event_date', array(
    'type'              => 'string',
    'single'            => true,
    'show_in_rest'      => true,
    'auth_callback'     => static function (): bool { return current_user_can( 'edit_posts' ); },
    'sanitize_callback' => 'sanitize_text_field',
) );
```

**Pick the sanitiser by declared type — and never pass a PHP internal function name as a string callback.** `register_post_meta` wires `sanitize_callback` into the `sanitize_{type}_meta_{key}` filter, which WordPress invokes with **four** arguments (`$value, $key, $object_type, $subtype`). PHP 8 makes extra arguments fatal for internal functions like `floatval`, `intval`, `boolval`, `strval`, `trim`, `strtolower` — the site hard-fatals on `init` the first time the meta is updated. WordPress *userland* functions (`sanitize_text_field`, `absint`, `rest_sanitize_boolean`) silently ignore extra args, so they are safe as bare strings. For anything else, wrap in a single-arg closure.

| Meta type | `sanitize_callback` |
|-----------|---------------------|
| `string`  | `'sanitize_text_field'` |
| `integer` | `'absint'` (non-negative) or `static fn ( $v ) => (int) $v` (signed) |
| `number`  | `static fn ( $v ) => (float) $v` — **never** `'floatval'` |
| `boolean` | `'rest_sanitize_boolean'` |

### Taxonomies

Register custom taxonomies on `init` as well, attached to the content CPT, with `show_in_rest => true` and `hierarchical` set to match the use (`true` for category-like, `false` for tag-like).

```php
register_taxonomy( 'acme_event_type', 'acme_event', array(
    'label'        => 'Event Types',
    'public'       => true,
    'hierarchical' => true,
    'show_in_rest' => true,
) );
```

For ordinary blog posts, use the built-in `category` and `post_tag` — do not invent parallel taxonomies. Create terms when seeding content into the DB; do not write `wp_insert_term` loops in the plugin.

### Flush rewrite rules once

Content CPTs add archive URLs, so flush rewrites once, guarded by an option so it does not run on every request:

```php
if ( ! get_option( 'acme_rewrite_flushed' ) ) {
    flush_rewrite_rules();
    update_option( 'acme_rewrite_flushed', 1, '', false );
}
```

## REST routes

Front-end form submissions need a **custom, namespaced** REST route — the auto-created `/wp/v2/<rest_base>` route requires auth. Register on `rest_api_init`, namespace it `PREFIX/v1`, validate and sanitize **every** field via the `args` schema, and return `WP_Error` (with an HTTP status) on failure.

```php
add_action( 'rest_api_init', static function (): void {
    register_rest_route( 'acme/v1', '/reservation', array(
        'methods'             => 'POST',
        'callback'            => 'acme_handle_reservation',
        'permission_callback' => '__return_true', // public form; pair with strict args + sanitize
        'args'                => array(
            'name'         => array( 'type' => 'string',  'required' => true,  'sanitize_callback' => 'sanitize_text_field' ),
            'email'        => array( 'type' => 'string',  'required' => true,  'sanitize_callback' => 'sanitize_email' ),
            'phone'        => array( 'type' => 'string',  'required' => false, 'sanitize_callback' => 'sanitize_text_field' ),
            'booking_date' => array( 'type' => 'string',  'required' => true,  'sanitize_callback' => 'sanitize_text_field' ),
            'party_size'   => array( 'type' => 'integer', 'required' => true,  'sanitize_callback' => 'absint' ),
        ),
    ) );
} );

function acme_handle_reservation( WP_REST_Request $request ) {
    $email = $request->get_param( 'email' );
    if ( ! is_email( $email ) ) {
        return new WP_Error( 'invalid_email', 'Please provide a valid email address.', array( 'status' => 400 ) );
    }

    $post_id = wp_insert_post( array(
        'post_type'    => 'acme_reservation',
        'post_status'  => 'publish',
        'post_title'   => $request->get_param( 'name' ) . ' — ' . current_time( 'Y-m-d H:i' ),
        'meta_input'   => array(
            'email'        => $email,
            'phone'        => $request->get_param( 'phone' ),
            'booking_date' => $request->get_param( 'booking_date' ),
            'party_size'   => $request->get_param( 'party_size' ),
        ),
    ), true );

    if ( is_wp_error( $post_id ) ) {
        return new WP_Error( 'insert_failed', 'Could not save your request.', array( 'status' => 500 ) );
    }

    return rest_ensure_response( array( 'ok' => true, 'id' => $post_id ) );
}
```

Rules that make a route production-safe:

- The **form field keys, the `register_post_meta` keys, the REST `args` keys, and the JSON the block POSTs MUST all match exactly.** Drift produces `Missing parameter(s): …` errors at runtime. One field schema, used in four places.
- Pick the REST `sanitize_callback` from the field's intent: `text`/`tel`/`date`/`time` → `sanitize_text_field`; `email` → `sanitize_email`; `textarea` → `sanitize_textarea_field`; `url` → `esc_url_raw`; `integer` → `absint`; `number` → `static fn ( $v ) => (float) $v`; `boolean` → `rest_sanitize_boolean`.
- `permission_callback => '__return_true'` is acceptable for a *public* unauthenticated form, but only when paired with strict `args` validation. For any write that should require a logged-in user, verify the REST nonce and a capability in the same callback, returning `WP_Error` (never bare `false`, which WordPress turns into a message-less 403):

```php
'permission_callback' => static function ( WP_REST_Request $request ): bool|WP_Error {
    if ( ! wp_verify_nonce( $request->get_header( 'X-WP-Nonce' ), 'wp_rest' ) ) {
        return new WP_Error( 'rest_forbidden', 'Nonce verification failed.', array( 'status' => 401 ) );
    }
    if ( ! current_user_can( 'edit_posts' ) ) {
        return new WP_Error( 'rest_forbidden', 'You cannot do this.', array( 'status' => 403 ) );
    }
    return true;
},
```

- Never leak the raw post array in the response — return a redacted, canonical shape.
- For high-abuse public endpoints, add a honeypot field and/or a transient rate-limit keyed by IP.

## Custom block: warranted or not

Before authoring a block, decide whether it is warranted. The distinction is **content sections** (core blocks) vs **named features** (custom blocks).

**Use core blocks — no custom block** when the request is a content section, even an elaborate one. Compose existing blocks in templates/patterns:

| Request | Core composition |
|---|---|
| Hero | `cover` + heading + paragraph + buttons |
| Testimonials | `columns` > `column` > `group` + `quote` + `image` |
| Features grid | `columns` > `column` > `group` + `image` + `heading` + `paragraph` |
| Pricing | `columns` > `column` > `group` + `heading` + `list` + `buttons` |
| FAQ | repeated `details` blocks |
| Latest posts | `query` + `post-template` + `post-title` + `post-excerpt` |
| Gallery / portfolio | `gallery` or `columns` of `image` |

**Build a custom block** only for a *named, project-specific feature* that core blocks plus reasonable recommended plugins cannot provide:

- It **saves, fetches, or computes** data (a form that persists, a price calculator, an availability checker, a live filter over a CPT archive).
- It is a discrete interactive widget core does not ship (countdown, before/after slider, configurator, map picker, quiz).
- Editors should insert and configure it as a distinct reusable block with its own controls.

Never fake a block with a raw `core/html` block, a freehand `<section>`, or a `render.php`-only fragment with no `block.json`. If it is a section, compose core blocks. If it is a feature, write a real registered block. Never split the difference.

## The build-less plain-JS block recipe

Custom blocks here are **build-less plain JavaScript**: a `block.json`, a plain `editor.js` and/or `view.js` that call WordPress globals directly, registered server-side with `register_block_type`. No JSX. No `@wordpress/scripts`. No npm. No `import`. No bundler. The editor component uses `wp.element.createElement` (aliased to `el`) instead of JSX, and reads APIs off the `wp.*` globals (`wp.blocks`, `wp.element`, `wp.blockEditor`, `wp.components`, `wp.i18n`). Front-end interactivity uses plain DOM APIs (`querySelector`, `addEventListener`, `classList`, `dataset`) — **never the Interactivity API**, never `data-wp-*` directives, never `viewScriptModule`.

### block.json (apiVersion 3)

```json
{
    "$schema": "https://schemas.wp.org/trunk/block.json",
    "apiVersion": 3,
    "name": "acme/reservation-form",
    "title": "Reservation Form",
    "category": "widgets",
    "description": "A reservation request form that saves submissions to the site.",
    "textdomain": "acme",
    "supports": { "html": false },
    "editorScript": "file:./editor.js",
    "viewScript": "file:./view.js",
    "style": "file:./style.css",
    "editorStyle": "file:./editor.css",
    "render": "file:./render.php"
}
```

- `apiVersion: 3` always — it gives the iframed editor canvas that matches the front-end render context.
- Paths are `file:./<name>` resolving to siblings of `block.json` in the block directory — the files you authored, no build indirection.
- `editorScript` is loaded only in the editor; `viewScript` only on the front end; `style` in both; `editorStyle` only in the editor.
- Declare `render` only when there is a `render.php`. Declare `viewScript` only when there is a `view.js`. Never declare an asset whose file you did not write — a declared-but-missing file is a hard error.
- A dynamic block (server-rendered via `render.php`) needs **no `save`** at registration time. A static block needs a `save` and no `render`. Form/data blocks are almost always dynamic so the REST URL and nonce can be printed server-side.

### editor.js (plain JS, no JSX)

`registerBlockType` is called against the metadata `name`. The `edit` function returns elements built with `wp.element.createElement`. There is no `import`; everything comes off `wp.*`.

```js
( function ( blocks, element, blockEditor, i18n ) {
    var el = element.createElement;
    var useBlockProps = blockEditor.useBlockProps;
    var __ = i18n.__;

    blocks.registerBlockType( 'acme/reservation-form', {
        edit: function () {
            var blockProps = useBlockProps( { className: 'acme-reservation-form' } );
            return el(
                'div',
                blockProps,
                el( 'p', { className: 'acme-reservation-form__editor-note' },
                    __( 'Reservation form — renders on the front end.', 'acme' ) )
            );
        },
        // Dynamic block: server-rendered, so no front-end markup is saved.
        save: function () {
            return null;
        }
    } );
} )( window.wp.blocks, window.wp.element, window.wp.blockEditor, window.wp.i18n );
```

Notes:

- `useBlockProps` (and `useBlockProps.save()` for static blocks) keeps the editor markup wrapped in standard Gutenberg classes.
- For configurable blocks, read `wp.blockEditor.InspectorControls` and `wp.components.*` (e.g. `PanelBody`, `TextControl`) off the globals and compose them with `el(...)` — still no JSX.
- The plugin must enqueue these `wp.*` packages as script dependencies. With build-less blocks, list them in `block.json` is not enough for globals; the simplest reliable path is to declare the editor script's dependencies in PHP via an asset file or by enqueuing with an explicit deps array. The pragmatic recipe: keep `editorScript` in `block.json` and additionally register the dependency array from PHP so `wp-blocks`, `wp-element`, `wp-block-editor`, `wp-components`, and `wp-i18n` are present:

```php
add_action( 'init', static function (): void {
    wp_register_script(
        'acme-reservation-form-editor',
        plugins_url( 'blocks/reservation-form/editor.js', __FILE__ ),
        array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
        '1.0.0',
        true
    );
} );
```

When you register the editor script explicitly like this, omit `editorScript` from `block.json` and instead pass the handle so `register_block_type` reuses it, or keep `block.json`'s `editorScript` and let WordPress load it without an asset file (acceptable because the script only references already-loaded `wp.*` globals). Prefer the explicit `wp_register_script` form whenever the editor component touches `wp.components` or `wp.blockEditor`, so the dependency graph is correct.

### render.php (server render for dynamic blocks)

Print the REST endpoint and a nonce into data attributes so `view.js` can read them. Escape every output.

```php
<?php
$endpoint = esc_url_raw( rest_url( 'acme/v1/reservation' ) );
$nonce    = wp_create_nonce( 'wp_rest' );
?>
<form
    <?php echo get_block_wrapper_attributes( array( 'class' => 'acme-reservation-form' ) ); ?>
    data-endpoint="<?php echo esc_attr( $endpoint ); ?>"
    data-nonce="<?php echo esc_attr( $nonce ); ?>"
>
    <label><?php echo esc_html__( 'Name', 'acme' ); ?>
        <input type="text" name="name" required>
    </label>
    <label><?php echo esc_html__( 'Email', 'acme' ); ?>
        <input type="email" name="email" required>
    </label>
    <label><?php echo esc_html__( 'Date', 'acme' ); ?>
        <input type="date" name="booking_date" required>
    </label>
    <label><?php echo esc_html__( 'Party size', 'acme' ); ?>
        <input type="number" name="party_size" min="1" step="1" required>
    </label>
    <button type="submit"><?php echo esc_html__( 'Request reservation', 'acme' ); ?></button>
    <p class="acme-reservation-form__status" aria-live="polite"></p>
</form>
```

Map the input element from the field's type: `text`→`text`, `email`→`email`, `textarea`→`<textarea>`, `url`→`url`, `tel`→`tel`, `date`→`date`, `time`→`time`, `datetime`→`datetime-local`, `integer`→`number step="1"`, `number`→`number step="any"`, `boolean`→`checkbox`. Add the `required` attribute on every field whose schema marks it required.

### view.js (plain DOM, no Interactivity API)

Intercept submit, POST JSON to the REST endpoint with the nonce header, show success/error in the `aria-live` region.

```js
document.querySelectorAll( '.acme-reservation-form' ).forEach( function ( form ) {
    form.addEventListener( 'submit', function ( event ) {
        event.preventDefault();
        var status = form.querySelector( '.acme-reservation-form__status' );
        var body   = {};
        new FormData( form ).forEach( function ( value, key ) {
            body[ key ] = value;
        } );
        // Coerce numeric fields the REST args expect as integers/numbers.
        if ( body.party_size ) {
            body.party_size = parseInt( body.party_size, 10 );
        }
        status.textContent = 'Sending…';
        fetch( form.dataset.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-WP-Nonce': form.dataset.nonce
            },
            body: JSON.stringify( body )
        } )
            .then( function ( response ) {
                return response.json().then( function ( data ) {
                    if ( ! response.ok ) {
                        throw new Error( ( data && data.message ) || 'Submission failed.' );
                    }
                    return data;
                } );
            } )
            .then( function () {
                form.reset();
                status.textContent = 'Thank you — we will be in touch.';
            } )
            .catch( function ( error ) {
                status.textContent = error.message;
            } );
    } );
} );
```

For a *stateful, non-form* block (countdown, slider, filter), the same recipe applies: dynamic block, `render.php` emits the markup with `data-*` config, `save: () => null`, and `view.js` reads `dataset.*`, attaches `addEventListener`, and toggles `classList`. Scope every selector to the block's own class (`.wp-block-acme-<slug>` or the className you set in `render.php`). Never register an Interactivity API store.

### Why a block renders empty (check these first)

A build-less block silently renders nothing when:

1. `register_block_type( __DIR__ . '/blocks/<slug>' )` was never called from the plugin — nothing registered it.
2. `block.json` declares `"render": "file:./render.php"` but `render.php` is missing or sits at the wrong path. Same for a declared `viewScript` without `view.js`.
3. A `file:` path points somewhere other than a sibling of `block.json`.

There is no build step to blame here — if the files exist next to `block.json` and `register_block_type` points at the directory, it loads.

## Seeding content into the live database

Content is **never** a file in the plugin or theme. After the packages are written, seed via WP-CLI / the `seed_content` tool, writing directly into the running site's database:

- **Pages and posts** — insert as `page`/`post` with real block markup in `post_content`. Create `category`/`post_tag` terms as needed and attach them; set a post format with `wp post term set` / the appropriate WP-CLI call only when the design uses formats.
- **Content CPT entries** — insert posts of the CPT type with their `register_post_meta` values filled in via `--meta_input` (or `wp post meta set`), and set a featured image where the design expects one.
- **Submission CPT samples** — seed 2-3 fictional historical submissions (invented names, `jordan@example.com`-style emails, varied dates across the last ~30 days) so the `wp-admin` list is immediately tangible. Fill every meta field. This bypasses the REST route — it is trusted server-side seeding.

Idempotency is the seeding step's concern, not the plugin's: do not add `_seed_id` meta or `after_switch_theme` seed helpers, and never write `wp_insert_post` loops into the plugin for content. The plugin's only `wp_insert_post` is the one inside a REST submission handler.

## Code quality (applies to all plugin PHP and JS)

- Escape every output by context: `esc_html`, `esc_attr`, `esc_url`, `wp_kses_post`, `esc_textarea`. Never echo a variable raw.
- Sanitize every input: `sanitize_text_field`, `sanitize_email`, `sanitize_textarea_field`, `esc_url_raw`, `absint`, `wp_kses_post`. Never trust `$_POST`/`$_GET`/`$_REQUEST` directly.
- Every write endpoint validates input via REST `args` and, when not a public form, verifies nonce + capability in the same callback.
- `add_option`/`update_option` for anything over ~1 KB must pass `false` for autoload: `update_option( 'acme_cache', $value, false )`.
- Cache expensive queries/HTTP in transients; bound every `WP_Query` with an explicit `posts_per_page` (never `-1` on unbounded data); use `$wpdb->prepare()` for any raw SQL; use `wp_remote_get()` with a timeout, never `file_get_contents()` for HTTP.
- Type every PHP signature (params and return); document array shapes in PHPDoc; avoid `mixed`.
- Make user-facing strings translatable with `__()` / `esc_html__()` against the plugin text domain.

## Block markup rules (when emitting block markup anywhere — render.php, patterns, seeded content)

- Prefer core blocks for content; reserve custom blocks for named features.
- Put custom classNames **only on the outermost block wrapper** via the block `className` attribute — never on inner DOM.
- Full-bleed sections: wrap in an outer `group` with `align:full`.
- Whenever a block sets `backgroundColor` it MUST also set `textColor` (and navigation needs full color props) — this prevents invisible text.
- Sticky positioning goes on the `.wp-block-template-part` wrapper, not the inner group.
- Scroll animations use progressive enhancement: CSS defines the **final visible** state, JS adds the **initial hidden** state, and every animation respects `@media (prefers-reduced-motion: reduce)`.
- No emojis anywhere. No decorative HTML comments — only block delimiter comments.
