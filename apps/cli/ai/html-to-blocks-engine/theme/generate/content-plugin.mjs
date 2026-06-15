// tools/theme/generate/content-plugin.mjs
import path from 'node:path';
import { writeFile, writeJson } from '../../lib/workspace.mjs';

export function writeContentPlugin({ slug, themeName, outDir, pages }) {
    const prefix = slug.replace(/-/g, '_') + '_content';
    writeJson(path.join(outDir, 'content/manifest.json'), {
        theme: slug,
        pages: pages.map(({ markup, ...page }) => page),
    });
    for (const page of pages) {
        writeFile(path.join(outDir, `content/${page.slug}.html`), `${page.markup.trim()}\n`);
    }
    writeFile(path.join(outDir, `${slug}-content.php`), contentPluginPhp({ slug, themeName, prefix }));
    return { prefix, pageCount: pages.length };
}

function contentPluginPhp({ slug, themeName, prefix }) {
    return `<?php
/**
 * Plugin Name: ${themeName} Content
 * Description: Imports and removes the ${themeName} theme's generated pages. Safe to delete after import.
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * Requires Plugins: ${slug}-blocks
 * License: GPL-2.0-or-later
 * Text Domain: ${slug}-content
 */

defined('ABSPATH') || exit;

const ${prefix.toUpperCase()}_OPTION = '${prefix}_imported';
const ${prefix.toUpperCase()}_META = '_${prefix}_generated';

function ${prefix}_manifest() {
    $manifest = json_decode(file_get_contents(__DIR__ . '/content/manifest.json'), true);
    return is_array($manifest) ? $manifest : array('pages' => array());
}

function ${prefix}_import_pages() {
    $state = get_option(${prefix.toUpperCase()}_OPTION, array());
    $results = array();
    foreach (${prefix}_manifest()['pages'] as $page) {
        $slug = $page['slug'];
        if (isset($state[$slug]) && get_post($state[$slug]['post_id'])) {
            $results[$slug] = array('status' => 'already-imported', 'permalink' => get_permalink($state[$slug]['post_id']));
            continue;
        }
        $existing = get_page_by_path($slug);
        if ($existing && !get_post_meta($existing->ID, ${prefix.toUpperCase()}_META, true)) {
            $results[$slug] = array('status' => 'slug-collision', 'permalink' => null);
            continue;
        }
        $markup = file_get_contents(__DIR__ . '/content/' . $slug . '.html');
        $markup = str_replace('{{THEME_URI}}', get_stylesheet_directory_uri(), $markup);
        // wp_insert_post unslashes its input; without wp_slash the JSON
        // escapes in block comments (& etc.) lose their backslash and
        // the editor sees corrupted attribute values
        $post_id = wp_insert_post(array(
            'post_type' => 'page',
            'post_status' => 'publish',
            'post_title' => wp_slash($page['title']),
            'post_name' => $slug,
            'post_content' => wp_slash($markup),
        ));
        if (is_wp_error($post_id)) {
            $results[$slug] = array('status' => 'error: ' . $post_id->get_error_message(), 'permalink' => null);
            continue;
        }
        update_post_meta($post_id, ${prefix.toUpperCase()}_META, '1');
        if (!empty($page['template'])) {
            update_post_meta($post_id, '_wp_page_template', $page['template']);
        }
        if (!empty($page['front'])) {
            update_option('show_on_front', 'page');
            update_option('page_on_front', $post_id);
        }
        $state[$slug] = array('post_id' => $post_id, 'imported_at' => time());
        $results[$slug] = array('status' => 'imported', 'permalink' => get_permalink($post_id));
    }
    update_option(${prefix.toUpperCase()}_OPTION, $state);
    return $results;
}

function ${prefix}_remove_pages() {
    $state = get_option(${prefix.toUpperCase()}_OPTION, array());
    foreach ($state as $slug => $entry) {
        $post = get_post($entry['post_id']);
        if ($post && get_post_meta($post->ID, ${prefix.toUpperCase()}_META, true)) {
            if ((int) get_option('page_on_front') === $post->ID) {
                update_option('show_on_front', 'posts');
                update_option('page_on_front', 0);
            }
            wp_delete_post($post->ID, true);
        }
        unset($state[$slug]);
    }
    update_option(${prefix.toUpperCase()}_OPTION, $state);
}

function ${prefix}_page_status($page, $state) {
    if (!isset($state[$page['slug']])) return 'not imported';
    $entry = $state[$page['slug']];
    $post = get_post($entry['post_id']);
    if (!$post) return 'not imported';
    if (strtotime($post->post_modified_gmt) > (int) $entry['imported_at'] + 5) return 'modified since import';
    return 'imported';
}

add_action('admin_menu', function () {
    add_management_page(
        '${themeName} content', '${themeName} content', 'manage_options', '${slug}-content',
        function () {
            if (!current_user_can('manage_options')) return;
            if (isset($_POST['${prefix}_action']) && wp_verify_nonce($_POST['_wpnonce'] ?? '', '${prefix}')) {
                if ($_POST['${prefix}_action'] === 'import') ${prefix}_import_pages();
                if ($_POST['${prefix}_action'] === 'remove') ${prefix}_remove_pages();
            }
            $state = get_option(${prefix.toUpperCase()}_OPTION, array());
            echo '<div class="wrap"><h1>${themeName} content</h1><table class="widefat striped"><thead><tr><th>Page</th><th>Slug</th><th>Status</th></tr></thead><tbody>';
            foreach (${prefix}_manifest()['pages'] as $page) {
                echo '<tr><td>' . esc_html($page['title']) . ($page['front'] ? ' <em>(front page)</em>' : '') . '</td><td>'
                    . esc_html($page['slug']) . '</td><td>' . esc_html(${prefix}_page_status($page, $state)) . '</td></tr>';
            }
            echo '</tbody></table><form method="post" style="margin-top:12px">';
            wp_nonce_field('${prefix}');
            echo '<button class="button button-primary" name="${prefix}_action" value="import">Import pages</button> ';
            echo '<button class="button" name="${prefix}_action" value="remove" onclick="return confirm(\\'Remove all imported pages? Modified pages will be deleted too.\\')">Remove imported pages</button>';
            echo '</form></div>';
        }
    );
});
`;
}
