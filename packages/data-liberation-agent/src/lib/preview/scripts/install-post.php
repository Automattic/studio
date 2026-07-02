<?php
/**
 * install-post.php — vendored helper invoked by post-install.ts via
 * `studio wp eval-file <this-file> <json-payload-path>`.
 *
 * Reads a JSON payload describing one post (page / post / product / etc.)
 * and either inserts a new post or updates the existing one (matched by
 * `_source_url` meta), then prints the result as JSON on stdout.
 *
 * Idempotency / update behavior:
 *   - No existing post for this _source_url → wp_insert_post → action="inserted".
 *   - Existing post found → wp_update_post replaces post_content (and
 *     title / slug / excerpt / status when those fields are present in
 *     the payload). action="updated". This is the streaming compose-then-
 *     install contract: when the runner re-runs with new block markup,
 *     the existing raw-HTML post must be overwritten — never left stale.
 *   - The original "reused" no-op behavior was a footgun: a prior run that
 *     installed raw HTML would prevent compose-then-install from ever
 *     replacing post_content with blocks.
 *
 * Payload shape:
 *   {
 *     "_source_url": "https://example.com/about",
 *     "post_type":   "page" | "post" | ...,
 *     "title":       string,
 *     "slug":        string,
 *     "content":     string,
 *     "excerpt":     string?,
 *     "date":        "YYYY-MM-DD HH:MM:SS"?,
 *     "post_status": "publish"?,
 *     "meta":        { "_seo_title": "...", ... }?
 *   }
 *
 * Output:
 *   { "post_id": 123, "action": "inserted" | "updated" }
 *   { "post_id": null, "action": "error", "error": "<message>" }
 */

// WP-CLI eval-file exposes positional args via the global `$args` array
// (zero-indexed, only the args AFTER the script path). PHP's standard
// `$argv` isn't reliable in this context — Studio's wp-cli invocation
// sometimes leaves it empty or off-by-one. Fall back to `$argv[1]` if
// `$args` isn't set (older wp-cli versions).
$json_path = null;
if (isset($args) && is_array($args) && !empty($args[0])) {
    $json_path = $args[0];
} elseif (isset($argv[1])) {
    $json_path = $argv[1];
}
if (!$json_path || !file_exists($json_path)) {
    echo json_encode([
        'post_id' => null,
        'action' => 'error',
        'error' => 'missing JSON payload',
        'tried' => $json_path,
    ]);
    exit(1);
}

$post_data = json_decode(file_get_contents($json_path), true);
if (!is_array($post_data) || empty($post_data['_source_url'])) {
    echo json_encode(['post_id' => null, 'action' => 'error', 'error' => 'invalid payload (need _source_url)']);
    exit(1);
}

$post_type   = isset($post_data['post_type']) ? $post_data['post_type'] : 'post';
$source_url  = $post_data['_source_url'];

// Look up an existing post for this _source_url. The result drives
// insert-vs-update; either way, a new wp_insert_post is never created
// for a URL that already has one (idempotent on _source_url).
$existing = get_posts(array(
    'post_type'      => $post_type,
    'meta_key'       => '_source_url',
    'meta_value'     => $source_url,
    'posts_per_page' => 1,
    'post_status'    => 'any',
    'fields'         => 'ids',
));

$base_meta = array_merge(
    array('_source_url' => $source_url),
    isset($post_data['meta']) && is_array($post_data['meta']) ? $post_data['meta'] : array()
);

if (!empty($existing)) {
    // UPDATE path: replace post_content (and title/slug/excerpt/status
    // when present) on the existing post. Meta gets re-applied via the
    // same meta_input array — wp_update_post merges, so existing meta
    // keys not in $base_meta are preserved.
    $existing_id = (int) $existing[0];
    $update = array(
        'ID'           => $existing_id,
        'post_title'   => isset($post_data['title']) ? $post_data['title'] : '',
        'post_name'    => isset($post_data['slug']) ? $post_data['slug'] : '',
        'post_content' => isset($post_data['content']) ? $post_data['content'] : '',
        'post_excerpt' => isset($post_data['excerpt']) ? $post_data['excerpt'] : '',
        'post_status'  => isset($post_data['post_status']) ? $post_data['post_status'] : 'publish',
        'meta_input'   => $base_meta,
    );
    if (!empty($post_data['date'])) {
        $update['post_date'] = $post_data['date'];
    }

    // wp_update_post() runs wp_unslash() internally, so slash first or it
    // strips backslashes from block-attribute JSON (e.g. dla/editable-html's
    // `frame` escapes \n and -), invalidating the block in the editor.
    $result = wp_update_post(wp_slash($update), true);
    if (is_wp_error($result)) {
        echo json_encode(array(
            'post_id' => null,
            'action'  => 'error',
            'error'   => $result->get_error_message(),
        ));
        exit(1);
    }

    echo json_encode(array(
        'post_id' => (int) $result,
        'action'  => 'updated',
    ));
    exit(0);
}

// INSERT path: no prior post for this URL.
$postarr = array(
    'post_title'   => isset($post_data['title']) ? $post_data['title'] : '',
    'post_name'    => isset($post_data['slug']) ? $post_data['slug'] : '',
    'post_type'    => $post_type,
    'post_content' => isset($post_data['content']) ? $post_data['content'] : '',
    'post_excerpt' => isset($post_data['excerpt']) ? $post_data['excerpt'] : '',
    'post_date'    => !empty($post_data['date']) ? $post_data['date'] : current_time('mysql'),
    'post_status'  => isset($post_data['post_status']) ? $post_data['post_status'] : 'publish',
    'meta_input'   => $base_meta,
);

// wp_slash() before insert: wp_insert_post() unslashes internally, which would
// otherwise strip backslashes from block-attribute JSON (dla/editable-html
// `frame`), invalidating the block. Slash→unslash is identity for plain text.
$id = wp_insert_post(wp_slash($postarr), true, true);
if (is_wp_error($id)) {
    echo json_encode(array(
        'post_id' => null,
        'action'  => 'error',
        'error'   => $id->get_error_message(),
    ));
    exit(1);
}

echo json_encode(array(
    'post_id' => (int) $id,
    'action'  => 'inserted',
));
