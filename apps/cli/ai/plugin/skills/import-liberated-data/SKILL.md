---
name: import-liberated-data
description: Import extracted website content (WXR, media, products) into a local WordPress Studio site via WP-CLI
user-invokable: false
---

# Import Liberated Data into Studio

Import content from a data-liberation extraction into a local WordPress Studio site. This skill handles the Studio-specific import workflow — site selection, file copying (required for PHP-WASM), plugin installation, WXR import, WooCommerce product import, and cleanup.

This skill is invoked by the `liberate` skill when it receives a delegated import manifest. Do not invoke this skill directly — it requires a manifest from `liberate_import` with `delegate: true`.

## Prerequisites

You should have an import manifest from `liberate_import` with `delegate: true` containing:
- `wxrFile` — path to the WXR file
- `outputDir` — extraction output directory
- `mediaDir` — path to downloaded media (or null)
- `productsCsv` — path to WooCommerce products CSV (or null)
- `redirectMap` — path to redirect mappings (or null)
- `importAuthors` — boolean

## Step 1: Prepare the target site

Ask the user which site to import into, or offer to create a new one:

- **List sites**: call `site_list` to show existing local sites
- **Create new**: call `site_create` with a name based on the source site
- **Start site**: call `site_start` if the chosen site is not already running

The site must be running before proceeding.

## Step 2: Install required plugins

Using `wp_cli` on the target site, install ALL required plugins BEFORE proceeding to any file copying or import steps:

1. Install the WordPress Importer:
   ```
   plugin install wordpress-importer --activate
   ```

2. **REQUIRED when `productsCsv` is not null**: Install and activate WooCommerce. Do NOT skip this step — product import will fail without it:
   ```
   plugin install woocommerce --activate
   ```

Do not proceed to Step 3 until all required plugins are installed and active.

## Step 3: Copy files into the site directory

WordPress Studio runs WordPress via PHP-WASM, which can only access files mounted within the site directory. The extraction output is outside the site, so files must be copied in before import.

Copy from the manifest paths into the site's `wp-content/imports/` directory:
- Copy the WXR file
- Copy the media directory (if `mediaDir` is not null)
- Copy the products CSV (if `productsCsv` is not null)

Use the file system tools (Write, Bash) to perform the copy.

## Step 4: Import the WXR

Run via `wp_cli` on the target site:

```
import /wordpress/wp-content/imports/<wxr-filename> --authors=create
```

Or with `--authors=skip` if the manifest has `importAuthors: false`.

**Important**: Use the `/wordpress/` prefix for the file path — that is the mount point for the site directory inside the PHP-WASM runtime.

## Step 5: Import products (if applicable)

If `productsCsv` was in the manifest:

1. Call `install_import_scripts` with the site name/path to copy the import PHP script into the site
2. Run via `wp_cli`:
   ```
   eval-file tmp/import-liberated-data/import-products.php
   ```
   The script uses WooCommerce's built-in `WC_Product_CSV_Importer` class and reads the CSV from `/wordpress/wp-content/imports/products.csv` by default.

## Step 6: Cleanup

After successful import:
1. Remove the site's `wp-content/imports/` directory
2. Remove the extraction output directory (`outputDir` from the manifest)

## Step 7: Report

Show the user a summary of what was imported:
- Number of pages, posts, media items
- Whether products were imported
- The site URL where they can review the content
- Remind them that all content is imported as drafts
