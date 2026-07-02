<?php
/**
 * site-finalize.php — vendored helper invoked by site-finalize.ts via
 * `studio wp eval-file <this-file> <json-payload-path>`.
 *
 * Applies the post-install site finalization writes in ONE wp-cli round-trip:
 * option updates (blogname etc.), per-page _wp_page_template assigns, and the
 * static front-page pair (show_on_front / page_on_front). Consolidated because
 * Studio's IPC layer flakes on bursts of individual argv commands ("Timeout
 * waiting for response to message wp-cli-command: No activity for 120s")
 * while a single eval-file call — the same shape install-post.php uses —
 * succeeds reliably: one IPC slot, values via JSON file, not argv.
 *
 * Payload shape:
 *   {
 *     "options":         { "blogname": "Acme", ... },
 *     "templateAssigns": [ { "postId": 12, "slug": "about", "template": "page-local" }, ... ],
 *     "frontPageId":     12?
 *   }
 *
 * Output (always one JSON object; per-item failures are collected, never fatal):
 *   {
 *     "ok": true|false,            // false when any item errored
 *     "applied": { "options": ["blogname"], "templates": [12], "frontPage": true },
 *     "errors": [ { "item": "option:blogname" | "template:<slug>" | "frontPage", "error": "..." } ]
 *   }
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
    echo json_encode(array(
        'ok'      => false,
        'applied' => array('options' => array(), 'templates' => array(), 'frontPage' => false),
        'errors'  => array(array('item' => 'payload', 'error' => 'missing JSON payload')),
        'tried'   => $json_path,
    ));
    exit(1);
}

$payload = json_decode(file_get_contents($json_path), true);
if (!is_array($payload)) {
    echo json_encode(array(
        'ok'      => false,
        'applied' => array('options' => array(), 'templates' => array(), 'frontPage' => false),
        'errors'  => array(array('item' => 'payload', 'error' => 'invalid JSON payload')),
    ));
    exit(1);
}

$applied = array('options' => array(), 'templates' => array(), 'frontPage' => false);
$errors  = array();

// Option updates. update_option returns false BOTH on failure and when the
// stored value already equals the new one — verify by reading back instead of
// trusting the boolean (idempotent re-runs must not report errors).
// The readback compares against sanitize_option($name, $value) — the SAME
// pre-storage oracle update_option applies (blogname/blogdescription run
// esc_html via the sanitize_option_{$name} filters, so raw "Tusk & Whisker"
// stores as "Tusk &amp; Whisker"; comparing the stored value to the RAW
// payload value would false-positive on every title containing & < > " ').
// _wp_specialchars doesn't double-encode, so re-runs stay idempotent.
$options = isset($payload['options']) && is_array($payload['options']) ? $payload['options'] : array();
foreach ($options as $name => $value) {
    try {
        update_option($name, $value);
        if (get_option($name) === sanitize_option($name, $value)) {
            $applied['options'][] = $name;
        } else {
            $errors[] = array('item' => 'option:' . $name, 'error' => 'option verify failed after update_option');
        }
    } catch (Throwable $e) {
        $errors[] = array('item' => 'option:' . $name, 'error' => $e->getMessage());
    }
}

// Per-page template assigns. Same verify-by-readback rationale as options:
// update_post_meta returns false when the meta already holds this value.
$assigns = isset($payload['templateAssigns']) && is_array($payload['templateAssigns']) ? $payload['templateAssigns'] : array();
foreach ($assigns as $assign) {
    $post_id  = isset($assign['postId']) ? (int) $assign['postId'] : 0;
    $slug     = isset($assign['slug']) && $assign['slug'] !== '' ? (string) $assign['slug'] : (string) $post_id;
    $template = isset($assign['template']) ? (string) $assign['template'] : '';
    try {
        if ($post_id <= 0 || $template === '') {
            $errors[] = array('item' => 'template:' . $slug, 'error' => 'invalid assign (postId/template required)');
            continue;
        }
        update_post_meta($post_id, '_wp_page_template', $template);
        if (get_post_meta($post_id, '_wp_page_template', true) === $template) {
            $applied['templates'][] = $post_id;
        } else {
            $errors[] = array('item' => 'template:' . $slug, 'error' => 'meta verify failed after update_post_meta');
        }
    } catch (Throwable $e) {
        $errors[] = array('item' => 'template:' . $slug, 'error' => $e->getMessage());
    }
}

// Static front page — both options together or reported as one failure
// (a half-applied pair is the worst outcome: show_on_front=page with a
// stale page_on_front serves the wrong front page).
if (!empty($payload['frontPageId'])) {
    $front_id = (int) $payload['frontPageId'];
    try {
        update_option('show_on_front', 'page');
        update_option('page_on_front', $front_id);
        if (get_option('show_on_front') === 'page' && (int) get_option('page_on_front') === $front_id) {
            $applied['frontPage'] = true;
        } else {
            $errors[] = array('item' => 'frontPage', 'error' => 'option verify failed after update_option pair');
        }
    } catch (Throwable $e) {
        $errors[] = array('item' => 'frontPage', 'error' => $e->getMessage());
    }
}

echo json_encode(array(
    'ok'      => count($errors) === 0,
    'applied' => $applied,
    'errors'  => $errors,
));
