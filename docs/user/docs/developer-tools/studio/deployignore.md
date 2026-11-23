# Exclude files from a preview with .deployignore

To leave files out of a preview, list them in a `.deployignore` file at the root of your site directory. The file uses the same pattern syntax as `.gitignore`.

**Applies to:** the WordPress Studio app, with a WordPress.com account. Previews are hosted on WordPress.com. The same file applies when you [publish](https://wordpress.studio/docs/sync/#exclude-files-with-deployignore) to WordPress.com or Pressable.

When WordPress Studio creates or updates a preview, it uploads the contents of your site’s `wp-content` directory. Use `.deployignore` to exclude files you don’t want in the preview, such as build artifacts, vendor dependencies, or large media folders.

## Before you start

- A local site in WordPress Studio, and access to its site directory.

## Add a .deployignore file

1.  In the root of your site directory, create a file named `.deployignore`.
2.  Add a pattern for each file or folder you want to leave out.
3.  Save the file.
4.  [Create or update the preview](https://wordpress.studio/docs/preview-sites/).

Patterns are relative to the site root directory, not to `wp-content`. For example:

```gitignore
# Exclude vendor dependencies
wp-content/plugins/my-plugin/vendor

# Exclude all log files
*.log

# Exclude old uploads
wp-content/uploads/2024

# Exclude a specific plugin
wp-content/plugins/wordpress-seo
```

You can also use negation patterns to re-include specific items:

```gitignore
# Exclude vendor, but keep important-lib
wp-content/plugins/my-plugin/vendor/*
!wp-content/plugins/my-plugin/vendor/important-lib
```

## What’s left out by default

Even without a `.deployignore` file, WordPress Studio leaves these out of a preview:

- The `.git`, `node_modules`, `.DS_Store`, and `Thumbs.db` directories.
- Themes that aren’t active, except the parent of the active theme, since they don’t change what the preview shows.
- The plugins that WordPress.com provides on every site.

Publishing a site to WordPress.com or Pressable uses the same `.deployignore` file, so the patterns you add also leave files out of a publish. See [Publish](https://wordpress.studio/docs/sync/#exclude-files-with-deployignore).

## Troubleshooting

### Why is a file missing from my preview?

A pattern in `.deployignore` may match it, or WordPress Studio may leave it out by default. Check that your patterns are relative to the site root directory, not to `wp-content`. To keep a file inside an excluded folder, add a negation pattern that starts with `!`.

### Why is my site too large to preview?

WordPress Studio can’t create or update a preview when the files it would upload are larger than 2 GB (gigabytes). Add the large folders, such as old uploads or vendor dependencies, to `.deployignore`, or remove media files, plugins, or themes you don’t need.

## Related

- [Share a preview of your site](https://wordpress.studio/docs/preview-sites/)
- [Preview changes to a live site](https://wordpress.studio/docs/preview-sites/#preview-changes-to-a-live-site)
- [Publish](https://wordpress.studio/docs/sync/)
- [Import/Export](https://wordpress.studio/docs/import-export/)
