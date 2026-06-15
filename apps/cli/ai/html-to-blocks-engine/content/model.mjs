// tools/content/model.mjs — validate and apply agent-authored WordPress content models.
import fs from 'node:fs';
import path from 'node:path';
import { resolvePath, resolveWorkspacePath, readJson, writeFile, writeJson, slug, titleCase } from '../lib/workspace.mjs';

const POST_TYPE_MAX = 20;
const TAXONOMY_MAX = 32;
const MODEL_TYPES = new Set(['content', 'submission']);
const FIELD_TYPES = new Set(['string', 'boolean', 'integer', 'number', 'array', 'object']);
const RESERVED_POST_TYPES = new Set(['post', 'page', 'attachment', 'revision', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part']);
const RESERVED_TAXONOMIES = new Set(['category', 'post_tag', 'nav_menu', 'link_category', 'post_format']);

export function validateContentModel(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const modelPath = resolveWorkspacePath(workspaceRoot, args.modelPath || 'content-model/content-model.json');
    const reportPath = resolveWorkspacePath(workspaceRoot, args.reportPath || 'reports/content-model-validation.json');
    const raw = readJson(modelPath);
    const { model, errors, warnings } = normalizeContentModel(raw);
    const report = {
        valid: errors.length === 0,
        modelPath,
        reportPath,
        errors,
        warnings,
        counts: {
            postTypes: model.postTypes.length,
            taxonomies: model.taxonomies.length,
            metaFields: model.postTypes.reduce((sum, type) => sum + type.meta.length, 0),
            seedEntries: model.postTypes.reduce((sum, type) => sum + type.seed.length, 0),
        },
    };
    writeJson(reportPath, report);
    return report;
}

export function scaffoldContentModelPlugin(args) {
    const workspaceRoot = resolvePath(args.workspaceRoot);
    const modelPath = resolveWorkspacePath(workspaceRoot, args.modelPath || 'content-model/content-model.json');
    const report = validateContentModel(args);
    if (!report.valid) {
        throw new Error(`Content model is invalid. See ${report.reportPath}`);
    }

    const { model } = normalizeContentModel(readJson(modelPath));
    const outDir = resolveWorkspacePath(workspaceRoot, args.outDir || 'content-model/plugin');
    const pluginSlug = model.plugin.slug;
    const pluginRoot = path.join(outDir, pluginSlug);
    const pluginFile = path.join(pluginRoot, `${pluginSlug}.php`);
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.mkdirSync(path.join(pluginRoot, 'content'), { recursive: true });
    const pluginModel = writeSeedPayloads(model, pluginRoot);
    writeJson(path.join(pluginRoot, 'content-model.json'), pluginModel);
    writeJson(path.join(pluginRoot, 'content/manifest.json'), {
        model: pluginModel.plugin,
        postTypes: pluginModel.postTypes.map((type) => ({
            slug: type.slug,
            kind: type.kind,
            singular: type.singular,
            plural: type.plural,
            seed: type.seed.map(({ content, ...entry }) => entry),
        })),
        taxonomies: pluginModel.taxonomies,
    });
    writeFile(pluginFile, contentModelPluginPhp(pluginModel));
    writeJson(path.join(workspaceRoot, 'content-model/plugin-manifest.json'), {
        plugin: model.plugin,
        sourceModel: path.relative(workspaceRoot, modelPath),
        pluginRoot: path.relative(workspaceRoot, pluginRoot),
        pluginFile: path.relative(workspaceRoot, pluginFile),
        generatedAt: new Date().toISOString(),
    });

    return {
        modelPath,
        validationReport: report.reportPath,
        pluginRoot,
        pluginFile,
        postTypes: model.postTypes.map((type) => type.slug),
        taxonomies: model.taxonomies.map((taxonomy) => taxonomy.slug),
        next: 'Install and activate this plugin in WordPress. Activation registers the model and flushes rewrites. Use Tools > Content model to import or remove generated seed content.',
    };
}

function writeSeedPayloads(model, pluginRoot) {
    const pluginModel = JSON.parse(JSON.stringify(model));
    for (const type of pluginModel.postTypes) {
        for (const entry of type.seed) {
            const content = String(entry.content || '');
            delete entry.content;
            if (!content.trim()) continue;
            const rel = `content/seeds/${type.slug}/${entry.slug}.html`;
            writeFile(path.join(pluginRoot, rel), `${content.trim()}\n`);
            entry.contentFile = rel;
        }
    }
    return pluginModel;
}

export function normalizeContentModel(raw) {
    const model = JSON.parse(JSON.stringify(raw || {}));
    const errors = [];
    const warnings = [];

    model.version = model.version || 1;
    model.plugin = model.plugin || {};
    const rawPluginSlug = String(model.plugin.slug || model.namespace || '').trim();
    model.plugin.slug = slug(rawPluginSlug);
    model.plugin.name = cleanLabel(model.plugin.name || titleCase(model.plugin.slug || 'Content Model'));
    model.plugin.description = cleanLabel(model.plugin.description || `Registers the ${model.plugin.name} WordPress content model.`);
    model.plugin.textDomain = slug(model.plugin.textDomain || model.plugin.slug);
    model.plugin.restNamespace = slug(model.plugin.restNamespace || model.plugin.slug || 'content-model').replace(/-/g, '_');
    model.postTypes = Array.isArray(model.postTypes) ? model.postTypes.map(normalizePostType) : [];
    model.taxonomies = Array.isArray(model.taxonomies) ? model.taxonomies.map(normalizeTaxonomy) : [];

    if (!model.plugin.slug) errors.push('plugin.slug is required.');
    if (rawPluginSlug && rawPluginSlug !== model.plugin.slug) errors.push(`plugin.slug must already be lowercase kebab-case: ${rawPluginSlug}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(model.plugin.slug || '')) errors.push(`plugin.slug must be lowercase kebab-case: ${model.plugin.slug || '(empty)'}`);
    if (!model.plugin.name) errors.push('plugin.name is required.');
    if (!model.postTypes.length && !model.taxonomies.length) warnings.push('Model has no postTypes or taxonomies.');

    const postTypeSlugs = new Set();
    for (const type of model.postTypes) {
        if (type.__rawSlug && type.__rawSlug !== type.slug) errors.push(`Post type slug must already be lowercase slug form: ${type.__rawSlug}`);
        validateSlug(type.slug, 'post type', POST_TYPE_MAX, errors);
        if (RESERVED_POST_TYPES.has(type.slug)) errors.push(`Post type slug is reserved by WordPress: ${type.slug}`);
        if (postTypeSlugs.has(type.slug)) errors.push(`Duplicate post type slug: ${type.slug}`);
        postTypeSlugs.add(type.slug);
        if (!MODEL_TYPES.has(type.kind)) errors.push(`Post type ${type.slug} kind must be "content" or "submission".`);
        validateFields(type.slug, type.meta, errors);
        validateFields(type.slug, type.formFields, errors, 'formFields');
        validateSeed(type, errors, warnings);
        if (type.kind === 'content' && !type.seed.length) warnings.push(`Content post type ${type.slug} has no seed entries.`);
        if (type.kind === 'submission' && !type.formFields.length && !type.meta.length) warnings.push(`Submission post type ${type.slug} has no formFields or meta fields.`);
    }

    const taxonomySlugs = new Set();
    for (const taxonomy of model.taxonomies) {
        if (taxonomy.__rawSlug && taxonomy.__rawSlug !== taxonomy.slug) errors.push(`Taxonomy slug must already be lowercase slug form: ${taxonomy.__rawSlug}`);
        validateSlug(taxonomy.slug, 'taxonomy', TAXONOMY_MAX, errors);
        if (RESERVED_TAXONOMIES.has(taxonomy.slug)) errors.push(`Taxonomy slug is reserved by WordPress: ${taxonomy.slug}`);
        if (taxonomySlugs.has(taxonomy.slug)) errors.push(`Duplicate taxonomy slug: ${taxonomy.slug}`);
        taxonomySlugs.add(taxonomy.slug);
        for (const typeSlug of taxonomy.postTypes) {
            if (!postTypeSlugs.has(typeSlug)) errors.push(`Taxonomy ${taxonomy.slug} references unknown post type: ${typeSlug}`);
        }
    }

    for (const type of model.postTypes) {
        for (const taxonomySlug of type.taxonomies) {
            if (!taxonomySlugs.has(taxonomySlug)) errors.push(`Post type ${type.slug} references unknown taxonomy: ${taxonomySlug}`);
        }
    }

    for (const type of model.postTypes) delete type.__rawSlug;
    for (const taxonomy of model.taxonomies) delete taxonomy.__rawSlug;

    return { model, errors, warnings };
}

function normalizePostType(input) {
    const type = { ...input };
    type.__rawSlug = String(type.slug || type.name || '').trim();
    type.slug = wpKeySlug(type.__rawSlug);
    type.kind = type.kind || 'content';
    type.singular = cleanLabel(type.singular || titleCase(type.slug));
    type.plural = cleanLabel(type.plural || pluralize(type.singular));
    type.menuName = cleanLabel(type.menuName || type.plural);
    type.description = cleanLabel(type.description || '');
    type.public = type.public ?? type.kind === 'content';
    type.showUi = type.showUi ?? true;
    type.showInRest = type.showInRest ?? true;
    type.restBase = slug(type.restBase || type.rewriteSlug || type.hasArchive || type.slug).replace(/_/g, '-');
    type.rewriteSlug = slug(type.rewriteSlug || type.hasArchive || type.restBase || type.slug);
    type.hasArchive = type.kind === 'content' ? (type.hasArchive ?? type.rewriteSlug) : false;
    type.menuIcon = type.menuIcon || (type.kind === 'submission' ? 'dashicons-feedback' : 'dashicons-admin-post');
    type.supports = Array.isArray(type.supports) && type.supports.length
        ? type.supports
        : type.kind === 'submission'
            ? ['title', 'editor', 'custom-fields']
            : ['title', 'editor', 'thumbnail', 'excerpt', 'custom-fields'];
    type.meta = normalizeFields(type.meta || type.fields || []);
    type.formFields = normalizeFields(type.formFields || []);
    type.taxonomies = Array.isArray(type.taxonomies) ? type.taxonomies.map(wpKeySlug).filter(Boolean) : [];
    type.seed = Array.isArray(type.seed) ? type.seed.map(normalizeSeedEntry) : [];
    return type;
}

function normalizeTaxonomy(input) {
    const taxonomy = { ...input };
    taxonomy.__rawSlug = String(taxonomy.slug || taxonomy.name || '').trim();
    taxonomy.slug = wpKeySlug(taxonomy.__rawSlug);
    taxonomy.singular = cleanLabel(taxonomy.singular || titleCase(taxonomy.slug));
    taxonomy.plural = cleanLabel(taxonomy.plural || pluralize(taxonomy.singular));
    taxonomy.description = cleanLabel(taxonomy.description || '');
    taxonomy.hierarchical = taxonomy.hierarchical ?? true;
    taxonomy.public = taxonomy.public ?? true;
    taxonomy.showInRest = taxonomy.showInRest ?? true;
    taxonomy.restBase = slug(taxonomy.restBase || taxonomy.slug).replace(/_/g, '-');
    taxonomy.rewriteSlug = slug(taxonomy.rewriteSlug || taxonomy.restBase || taxonomy.slug);
    taxonomy.postTypes = Array.isArray(taxonomy.postTypes) ? taxonomy.postTypes.map(wpKeySlug).filter(Boolean) : [];
    taxonomy.terms = Array.isArray(taxonomy.terms) ? taxonomy.terms.map(normalizeTerm) : [];
    return taxonomy;
}

function normalizeFields(fields) {
    return fields.map((field) => {
        const key = String(field.key || field.name || '').trim();
        return {
            ...field,
            key,
            label: cleanLabel(field.label || titleCase(key)),
            type: field.type || 'string',
            format: field.format || '',
            single: field.single ?? true,
            required: Boolean(field.required),
            description: cleanLabel(field.description || ''),
        };
    });
}

function normalizeSeedEntry(entry) {
    const normalized = { ...entry };
    normalized.slug = slug(normalized.slug || normalized.title || '');
    normalized.title = cleanLabel(normalized.title || titleCase(normalized.slug));
    normalized.status = normalized.status || 'publish';
    normalized.content = String(normalized.content || '');
    normalized.excerpt = String(normalized.excerpt || '');
    normalized.meta = normalized.meta && typeof normalized.meta === 'object' ? normalized.meta : {};
    normalized.terms = normalized.terms && typeof normalized.terms === 'object' ? normalized.terms : {};
    return normalized;
}

function normalizeTerm(term) {
    const value = typeof term === 'string' ? { name: term } : { ...term };
    value.slug = slug(value.slug || value.name || '');
    value.name = cleanLabel(value.name || titleCase(value.slug));
    value.description = cleanLabel(value.description || '');
    return value;
}

function validateSlug(value, kind, max, errors) {
    if (!value) {
        errors.push(`${kind} slug is required.`);
        return;
    }
    if (value.length > max) errors.push(`${kind} slug "${value}" is ${value.length} chars; WordPress max is ${max}.`);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(value)) errors.push(`${kind} slug must use lowercase letters, numbers, hyphens, or underscores: ${value}`);
}

function validateFields(typeSlug, fields, errors, label = 'meta') {
    const keys = new Set();
    for (const field of fields) {
        if (!field.key) errors.push(`${typeSlug}.${label} field key is required.`);
        if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(field.key || '')) errors.push(`${typeSlug}.${label} key must be alphanumeric/underscore/dash: ${field.key}`);
        if (keys.has(field.key)) errors.push(`Duplicate ${label} key on ${typeSlug}: ${field.key}`);
        keys.add(field.key);
        if (!FIELD_TYPES.has(field.type)) errors.push(`${typeSlug}.${label}.${field.key} type must be one of ${[...FIELD_TYPES].join(', ')}.`);
    }
}

function validateSeed(type, errors, warnings) {
    const metaKeys = new Set(type.meta.map((field) => field.key));
    const taxonomySet = new Set(type.taxonomies);
    const slugs = new Set();
    for (const entry of type.seed) {
        if (!entry.slug) errors.push(`Seed entry in ${type.slug} is missing slug.`);
        if (slugs.has(entry.slug)) errors.push(`Duplicate seed slug in ${type.slug}: ${entry.slug}`);
        slugs.add(entry.slug);
        for (const key of Object.keys(entry.meta || {})) {
            if (!metaKeys.has(key)) warnings.push(`Seed ${type.slug}/${entry.slug} sets undeclared meta key: ${key}`);
        }
        for (const taxonomySlug of Object.keys(entry.terms || {})) {
            if (!taxonomySet.has(taxonomySlug)) warnings.push(`Seed ${type.slug}/${entry.slug} sets terms for taxonomy not attached to post type: ${taxonomySlug}`);
        }
    }
}

function contentModelPluginPhp(model) {
    const prefix = phpIdentifier(model.plugin.slug);
    return `<?php
/**
 * Plugin Name: ${headerValue(model.plugin.name)}
 * Description: ${headerValue(model.plugin.description)}
 * Version: 1.0.0
 * Requires at least: 6.6
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 * Text Domain: ${headerValue(model.plugin.textDomain)}
 */

defined('ABSPATH') || exit;

const ${prefix.toUpperCase()}_MODEL_FILE = __DIR__ . '/content-model.json';
const ${prefix.toUpperCase()}_SEED_OPTION = '${prefix}_seed_imports';
const ${prefix.toUpperCase()}_SEED_META = '_${prefix}_seed_id';

function ${prefix}_model() {
    static $model = null;
    if ($model !== null) {
        return $model;
    }
    $json = file_get_contents(${prefix.toUpperCase()}_MODEL_FILE);
    $model = json_decode($json, true);
    return is_array($model) ? $model : array('postTypes' => array(), 'taxonomies' => array());
}

function ${prefix}_labels($plural, $singular, $menu_name = '') {
    $menu_name = $menu_name ?: $plural;
    return array(
        'name' => $plural,
        'singular_name' => $singular,
        'menu_name' => $menu_name,
        'add_new_item' => sprintf('Add New %s', $singular),
        'edit_item' => sprintf('Edit %s', $singular),
        'new_item' => sprintf('New %s', $singular),
        'view_item' => sprintf('View %s', $singular),
        'search_items' => sprintf('Search %s', $plural),
        'not_found' => sprintf('No %s found', strtolower($plural)),
    );
}

function ${prefix}_register_content_model() {
    $model = ${prefix}_model();

    foreach (($model['taxonomies'] ?? array()) as $taxonomy) {
        register_taxonomy($taxonomy['slug'], $taxonomy['postTypes'] ?? array(), array(
            'labels' => ${prefix}_labels($taxonomy['plural'], $taxonomy['singular']),
            'description' => $taxonomy['description'] ?? '',
            'hierarchical' => !empty($taxonomy['hierarchical']),
            'public' => array_key_exists('public', $taxonomy) ? (bool) $taxonomy['public'] : true,
            'show_ui' => true,
            'show_admin_column' => true,
            'show_in_rest' => array_key_exists('showInRest', $taxonomy) ? (bool) $taxonomy['showInRest'] : true,
            'rest_base' => $taxonomy['restBase'] ?? $taxonomy['slug'],
            'rewrite' => array('slug' => $taxonomy['rewriteSlug'] ?? $taxonomy['slug']),
        ));
    }

    foreach (($model['postTypes'] ?? array()) as $type) {
        $is_submission = ($type['kind'] ?? 'content') === 'submission';
        $public = array_key_exists('public', $type) ? (bool) $type['public'] : !$is_submission;
        register_post_type($type['slug'], array(
            'label' => $type['plural'],
            'labels' => ${prefix}_labels($type['plural'], $type['singular'], $type['menuName'] ?? ''),
            'description' => $type['description'] ?? '',
            'public' => $public,
            'show_ui' => array_key_exists('showUi', $type) ? (bool) $type['showUi'] : true,
            'show_in_menu' => true,
            'show_in_rest' => array_key_exists('showInRest', $type) ? (bool) $type['showInRest'] : true,
            'rest_base' => $type['restBase'] ?? $type['slug'],
            'has_archive' => $is_submission ? false : ($type['hasArchive'] ?? false),
            'publicly_queryable' => $is_submission ? false : $public,
            'exclude_from_search' => $is_submission,
            'menu_icon' => $type['menuIcon'] ?? 'dashicons-admin-post',
            'supports' => $type['supports'] ?? array('title', 'editor', 'custom-fields'),
            'taxonomies' => $type['taxonomies'] ?? array(),
            'rewrite' => $is_submission ? false : array('slug' => $type['rewriteSlug'] ?? $type['slug']),
            'map_meta_cap' => true,
        ));

        foreach (($type['meta'] ?? array()) as $field) {
            register_post_meta($type['slug'], $field['key'], array(
                'type' => $field['type'] ?? 'string',
                'single' => array_key_exists('single', $field) ? (bool) $field['single'] : true,
                'show_in_rest' => ${prefix}_rest_schema($field),
                'sanitize_callback' => function ($value) use ($field) {
                    return ${prefix}_sanitize_value($value, $field);
                },
            ));
        }
    }
}
add_action('init', '${prefix}_register_content_model');

function ${prefix}_rest_schema($field) {
    if (($field['type'] ?? '') === 'array' && isset($field['items'])) {
        return array('schema' => array('type' => 'array', 'items' => $field['items']));
    }
    if (($field['type'] ?? '') === 'object' && isset($field['properties'])) {
        return array('schema' => array('type' => 'object', 'properties' => $field['properties']));
    }
    return array_key_exists('showInRest', $field) ? (bool) $field['showInRest'] : true;
}

function ${prefix}_sanitize_value($value, $field) {
    $format = $field['format'] ?? '';
    switch ($field['type'] ?? 'string') {
        case 'boolean':
            return rest_sanitize_boolean($value);
        case 'integer':
            return intval($value);
        case 'number':
            return is_numeric($value) ? (float) $value : 0;
        case 'array':
            return is_array($value) ? array_map('sanitize_text_field', $value) : array();
        case 'object':
            return is_array($value) ? map_deep($value, 'sanitize_text_field') : array();
        case 'string':
        default:
            if ($format === 'email') return sanitize_email($value);
            if ($format === 'url') return esc_url_raw($value);
            if ($format === 'textarea') return sanitize_textarea_field($value);
            return sanitize_text_field($value);
    }
}

function ${prefix}_submission_fields($type) {
    return !empty($type['formFields']) ? $type['formFields'] : ($type['meta'] ?? array());
}

function ${prefix}_register_submission_routes() {
    $model = ${prefix}_model();
    $namespace = str_replace('_', '-', $model['plugin']['restNamespace'] ?? '${model.plugin.restNamespace}') . '/v1';
    foreach (($model['postTypes'] ?? array()) as $type) {
        if (($type['kind'] ?? 'content') !== 'submission') {
            continue;
        }
        $route = '/' . ($type['restRoute'] ?? $type['restBase'] ?? $type['slug']);
        $args = array();
        foreach (${prefix}_submission_fields($type) as $field) {
            $args[$field['key']] = array(
                'required' => !empty($field['required']),
                'type' => $field['type'] ?? 'string',
                'sanitize_callback' => function ($value) use ($field) {
                    return ${prefix}_sanitize_value($value, $field);
                },
            );
        }
        register_rest_route($namespace, $route, array(
            'methods' => 'POST',
            'callback' => function ($request) use ($type) {
                return ${prefix}_handle_submission($type, $request);
            },
            'permission_callback' => '__return_true',
            'args' => $args,
        ));
    }
}
add_action('rest_api_init', '${prefix}_register_submission_routes');

function ${prefix}_handle_submission($type, $request) {
    $params = $request->get_params();
    $meta = array();
    foreach (($type['meta'] ?? array()) as $field) {
        if (array_key_exists($field['key'], $params)) {
            $meta[$field['key']] = ${prefix}_sanitize_value($params[$field['key']], $field);
        }
    }
    $title = ${prefix}_submission_title($type, $params);
    $content = ${prefix}_submission_content($params);
    $post_id = wp_insert_post(array(
        'post_type' => $type['slug'],
        'post_status' => 'publish',
        'post_title' => $title,
        'post_content' => $content,
        'meta_input' => $meta,
    ), true);
    if (is_wp_error($post_id)) {
        return new WP_Error('insert_failed', 'Could not save submission.', array('status' => 500));
    }
    return rest_ensure_response(array('ok' => true, 'id' => $post_id));
}

function ${prefix}_submission_title($type, $params) {
    foreach (array('name', 'full_name', 'email', 'title') as $key) {
        if (!empty($params[$key])) {
            return sanitize_text_field($params[$key]) . ' — ' . current_time('Y-m-d H:i');
        }
    }
    return ($type['singular'] ?? 'Submission') . ' — ' . current_time('Y-m-d H:i');
}

function ${prefix}_submission_content($params) {
    foreach (array('message', 'notes', 'details', 'story', 'content') as $key) {
        if (!empty($params[$key])) {
            return sanitize_textarea_field($params[$key]);
        }
    }
    return wp_json_encode($params, JSON_PRETTY_PRINT);
}

function ${prefix}_seed_state() {
    $state = get_option(${prefix.toUpperCase()}_SEED_OPTION, array('posts' => array(), 'terms' => array()));
    if (!is_array($state)) $state = array();
    if (!isset($state['posts']) || !is_array($state['posts'])) $state['posts'] = array();
    if (!isset($state['terms']) || !is_array($state['terms'])) $state['terms'] = array();
    return $state;
}

function ${prefix}_seed_id($type, $entry) {
    return $type['slug'] . ':' . ($entry['seedId'] ?? $entry['slug']);
}

function ${prefix}_import_seed_terms(&$state) {
    $results = array();
    foreach ((${prefix}_model()['taxonomies'] ?? array()) as $taxonomy) {
        foreach (($taxonomy['terms'] ?? array()) as $term) {
            $seed_id = $taxonomy['slug'] . ':' . $term['slug'];
            $existing = term_exists($term['slug'], $taxonomy['slug']);
            if ($existing) {
                $results[$seed_id] = array('status' => 'already-exists', 'term_id' => is_array($existing) ? (int) $existing['term_id'] : (int) $existing);
                continue;
            }
            $created = wp_insert_term($term['name'], $taxonomy['slug'], array(
                'slug' => $term['slug'],
                'description' => $term['description'] ?? '',
            ));
            if (is_wp_error($created)) {
                $results[$seed_id] = array('status' => 'error: ' . $created->get_error_message(), 'term_id' => 0);
                continue;
            }
            $term_id = (int) $created['term_id'];
            $state['terms'][$seed_id] = array('term_id' => $term_id, 'taxonomy' => $taxonomy['slug'], 'imported_at' => time());
            $results[$seed_id] = array('status' => 'imported', 'term_id' => $term_id);
        }
    }
    return $results;
}

function ${prefix}_seed_entry_content($entry) {
    $content = $entry['content'] ?? '';
    if (!empty($entry['contentFile'])) {
        $file = __DIR__ . '/' . ltrim($entry['contentFile'], '/');
        if (is_readable($file)) {
            $content = file_get_contents($file);
        }
    }
    return str_replace('{{THEME_URI}}', get_stylesheet_directory_uri(), $content);
}

function ${prefix}_import_seed_posts(&$state) {
    $results = array();
    foreach ((${prefix}_model()['postTypes'] ?? array()) as $type) {
        foreach (($type['seed'] ?? array()) as $entry) {
            $seed_id = ${prefix}_seed_id($type, $entry);
            if (isset($state['posts'][$seed_id]) && get_post($state['posts'][$seed_id]['post_id'])) {
                $results[$seed_id] = array('status' => 'already-imported', 'post_id' => $state['posts'][$seed_id]['post_id']);
                continue;
            }
            $generated = get_posts(array(
                'post_type' => $type['slug'],
                'post_status' => 'any',
                'meta_key' => ${prefix.toUpperCase()}_SEED_META,
                'meta_value' => $seed_id,
                'posts_per_page' => 1,
                'fields' => 'ids',
            ));
            if ($generated) {
                $state['posts'][$seed_id] = array('post_id' => (int) $generated[0], 'post_type' => $type['slug'], 'slug' => $entry['slug'], 'imported_at' => time());
                $results[$seed_id] = array('status' => 'already-imported', 'post_id' => (int) $generated[0]);
                continue;
            }
            $collision = get_page_by_path($entry['slug'], OBJECT, $type['slug']);
            if ($collision) {
                $collision_seed_id = get_post_meta($collision->ID, ${prefix.toUpperCase()}_SEED_META, true);
                if ($collision_seed_id === $seed_id) {
                    $state['posts'][$seed_id] = array('post_id' => $collision->ID, 'post_type' => $type['slug'], 'slug' => $entry['slug'], 'imported_at' => time());
                    $results[$seed_id] = array('status' => 'already-imported', 'post_id' => $collision->ID);
                    continue;
                }
                $results[$seed_id] = array('status' => 'slug-collision', 'post_id' => $collision->ID);
                continue;
            }
            $meta = $entry['meta'] ?? array();
            $meta[${prefix.toUpperCase()}_SEED_META] = $seed_id;
            $post_id = wp_insert_post(array(
                'post_type' => $type['slug'],
                'post_status' => $entry['status'] ?? 'publish',
                'post_title' => wp_slash($entry['title']),
                'post_name' => $entry['slug'],
                'post_content' => wp_slash(${prefix}_seed_entry_content($entry)),
                'post_excerpt' => wp_slash($entry['excerpt'] ?? ''),
                'meta_input' => $meta,
            ), true);
            if (is_wp_error($post_id)) {
                $results[$seed_id] = array('status' => 'error: ' . $post_id->get_error_message(), 'post_id' => 0);
                continue;
            }
            foreach (($entry['terms'] ?? array()) as $taxonomy_slug => $terms) {
                wp_set_object_terms($post_id, array_values((array) $terms), $taxonomy_slug, false);
            }
            $state['posts'][$seed_id] = array('post_id' => $post_id, 'post_type' => $type['slug'], 'slug' => $entry['slug'], 'imported_at' => time());
            $results[$seed_id] = array('status' => 'imported', 'post_id' => $post_id);
        }
    }
    return $results;
}

function ${prefix}_import_seed_content() {
    ${prefix}_register_content_model();
    $state = ${prefix}_seed_state();
    $results = array(
        'terms' => ${prefix}_import_seed_terms($state),
        'posts' => ${prefix}_import_seed_posts($state),
    );
    update_option(${prefix.toUpperCase()}_SEED_OPTION, $state);
    return $results;
}

function ${prefix}_remove_seed_content() {
    $state = ${prefix}_seed_state();
    foreach ($state['posts'] as $seed_id => $entry) {
        $post = get_post($entry['post_id'] ?? 0);
        if ($post && get_post_meta($post->ID, ${prefix.toUpperCase()}_SEED_META, true) === $seed_id) {
            wp_delete_post($post->ID, true);
        }
        unset($state['posts'][$seed_id]);
    }
    foreach ((${prefix}_model()['postTypes'] ?? array()) as $type) {
        $posts = get_posts(array(
            'post_type' => $type['slug'],
            'post_status' => 'any',
            'meta_key' => ${prefix.toUpperCase()}_SEED_META,
            'posts_per_page' => -1,
            'fields' => 'ids',
        ));
        foreach ($posts as $post_id) {
            wp_delete_post($post_id, true);
        }
    }
    foreach ($state['terms'] as $seed_id => $entry) {
        $taxonomy = $entry['taxonomy'] ?? '';
        $term = get_term((int) ($entry['term_id'] ?? 0), $taxonomy);
        if ($term && !is_wp_error($term) && (int) $term->count === 0) {
            wp_delete_term($term->term_id, $taxonomy);
        }
        unset($state['terms'][$seed_id]);
    }
    update_option(${prefix.toUpperCase()}_SEED_OPTION, $state);
}

function ${prefix}_seed_post_status($type, $entry, $state) {
    $seed_id = ${prefix}_seed_id($type, $entry);
    if (isset($state['posts'][$seed_id])) {
        $tracked = $state['posts'][$seed_id];
        $post = get_post($tracked['post_id'] ?? 0);
        if ($post && get_post_meta($post->ID, ${prefix.toUpperCase()}_SEED_META, true) === $seed_id) {
            if (strtotime($post->post_modified_gmt) > (int) ($tracked['imported_at'] ?? 0) + 5) return 'modified since import';
            return 'imported';
        }
    }
    $generated = get_posts(array(
        'post_type' => $type['slug'],
        'post_status' => 'any',
        'meta_key' => ${prefix.toUpperCase()}_SEED_META,
        'meta_value' => $seed_id,
        'posts_per_page' => 1,
        'fields' => 'ids',
    ));
    if ($generated) return 'imported';
    $collision = get_page_by_path($entry['slug'], OBJECT, $type['slug']);
    if ($collision) return 'slug collision';
    return 'not imported';
}

function ${prefix}_seed_term_status($taxonomy, $term, $state) {
    $seed_id = $taxonomy['slug'] . ':' . $term['slug'];
    if (isset($state['terms'][$seed_id]) && term_exists((int) $state['terms'][$seed_id]['term_id'], $taxonomy['slug'])) return 'imported';
    if (term_exists($term['slug'], $taxonomy['slug'])) return 'already exists';
    return 'not imported';
}

function ${prefix}_activate() {
    ${prefix}_register_content_model();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, '${prefix}_activate');

register_deactivation_hook(__FILE__, function () {
    flush_rewrite_rules();
});

add_action('admin_menu', function () {
    add_management_page(
        '${jsString(model.plugin.name)}',
        '${jsString(model.plugin.name)}',
        'manage_options',
        '${model.plugin.slug}',
        '${prefix}_admin_page'
    );
});

function ${prefix}_admin_page() {
    if (!current_user_can('manage_options')) return;
    if (isset($_POST['${prefix}_action']) && wp_verify_nonce($_POST['_wpnonce'] ?? '', '${prefix}')) {
        if ($_POST['${prefix}_action'] === 'import') {
            ${prefix}_import_seed_content();
            echo '<div class="notice notice-success"><p>Seed content imported.</p></div>';
        }
        if ($_POST['${prefix}_action'] === 'remove') {
            ${prefix}_remove_seed_content();
            echo '<div class="notice notice-warning"><p>Generated seed content removed.</p></div>';
        }
    }
    $model = ${prefix}_model();
    $state = ${prefix}_seed_state();
    echo '<div class="wrap"><h1>' . esc_html($model['plugin']['name'] ?? 'Content model') . '</h1>';
    echo '<p>This plugin registers the content model while active. Seed content is imported only when requested.</p>';
    echo '<h2>Post type seeds</h2><table class="widefat striped"><thead><tr><th>Type</th><th>Kind</th><th>Seed</th><th>Slug</th><th>Status</th></tr></thead><tbody>';
    foreach (($model['postTypes'] ?? array()) as $type) {
        foreach (($type['seed'] ?? array()) as $entry) {
            echo '<tr><td>' . esc_html($type['slug']) . '</td><td>' . esc_html($type['kind'] ?? 'content') . '</td><td>' . esc_html($entry['title'] ?? $entry['slug']) . '</td><td>' . esc_html($entry['slug']) . '</td><td>' . esc_html(${prefix}_seed_post_status($type, $entry, $state)) . '</td></tr>';
        }
    }
    echo '</tbody></table><h2>Taxonomy seeds</h2><table class="widefat striped"><thead><tr><th>Taxonomy</th><th>Term</th><th>Slug</th><th>Status</th></tr></thead><tbody>';
    foreach (($model['taxonomies'] ?? array()) as $taxonomy) {
        foreach (($taxonomy['terms'] ?? array()) as $term) {
            echo '<tr><td>' . esc_html($taxonomy['slug']) . '</td><td>' . esc_html($term['name']) . '</td><td>' . esc_html($term['slug']) . '</td><td>' . esc_html(${prefix}_seed_term_status($taxonomy, $term, $state)) . '</td></tr>';
        }
    }
    echo '</tbody></table><form method="post" style="margin-top:12px">';
    wp_nonce_field('${prefix}');
    echo '<button class="button button-primary" name="${prefix}_action" value="import">Import seed content</button> ';
    echo '<button class="button" name="${prefix}_action" value="remove" onclick="return confirm(\\'Remove generated seed content? Modified generated posts will be deleted too. Generated terms are removed only when unused.\\')">Remove seed content</button>';
    echo '</form></div>';
}
`;
}

function cleanLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function pluralize(value) {
    const label = cleanLabel(value);
    if (!label) return '';
    if (/s$/i.test(label)) return label;
    return `${label}s`;
}

function phpIdentifier(value) {
    let id = slug(value).replace(/-/g, '_');
    if (!/^[A-Za-z_]/.test(id)) id = `wpcm_${id}`;
    return id || 'wpcm_content_model';
}

function wpKeySlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^[-_]+|[-_]+$/g, '');
}

function headerValue(value) {
    return cleanLabel(value).replace(/\*\//g, '* /');
}

function jsString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
