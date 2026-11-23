# Import and export sites

Add a site to WordPress Studio from a backup file, or save a local site as a backup file. You can also update an existing site from a backup.

To import, choose **Import** in the **Add site** dialog and select the file. To export, choose **Export** from the site menu.

**Applies to:** the WordPress Studio app. The same imports and exports are available in the terminal with [WordPress Studio CLI](https://wordpress.studio/docs/cli/#import-and-export). You don’t need a WordPress.com account to import or export.

If your site is on a paid WordPress.com plan or on [Pressable](https://pressable.com/), you can [pull it into WordPress Studio and publish it back](https://wordpress.studio/docs/sync/) instead, with no backup file.

## Before you start

- A backup file in a [supported format](https://wordpress.studio/docs/import-export/#supported-backup-formats). You can download a backup of a WordPress.com site from the site or from Jetpack’s Activity Log page.

## Add a new site from a backup

1.  <span id="how-to-add-a-new-site-to-wordpress-studio-from-a-backup"></span>Click **Add site** (**+**) next to **Sites** at the top of the sidebar.
2.  Choose **Import**.
3.  Click **Choose file** and select your backup file. The **Add site** form opens with your backup under **Start from**.
4.  Enter a name for the site.
5.  Check the **Site folder**. It must be empty.
6.  Click **Add site**.

The new site starts and appears in the sidebar.

Instead of clicking **Choose file**, you can drag your backup file onto the **Drop your file here** area, or anywhere on the **Add site** dialog.

Some websites that turn a site into a WordPress backup, such as [liberate.sh](https://liberate.sh), offer a link that opens the backup in the desktop app. WordPress Studio downloads the backup and opens the **Add site** form with it under **Start from**. WordPress Studio creates the site only when you click **Add site**.

## Update an existing site from a backup

> **Warning:** Importing a `.tar.gz`, `.tar`, `.zip`, or `.wpress` backup replaces the WordPress Studio site with the backup.

1.  <span id="how-to-update-an-existing-wordpress-studio-site-from-a-backup"></span>In the sidebar, select the site.
2.  Press ⌘K (Ctrl+K on Windows and Linux) to open the command palette.
3.  Search for **Import backup…** and choose it.
4.  Select your backup file.
5.  When WordPress Studio asks **Overwrite** followed by the site’s name, click **Import**.

What happens depends on the file:

| File | What the import does |
| --- | --- |
| `.tar.gz`, `.tar`, `.zip`, `.wpress` | Replaces the site with the backup |
| `.sql` | Imports the database dump on top of the existing site |
| `.xml` (WordPress export) | Adds its posts, pages, terms, authors, and media to the existing site |

## Export a site

<span id="how-to-export-a-site-from-wordpress-studio"></span>You can export the whole site as a `.zip` file that works with Jetpack Backup, or only the database as a `.sql` file that works with MySQL.

1.  Click the **Site menu** button, which shows the site’s name, at the top left of the site’s header.
2.  Choose **Export**.
3.  Choose **Export site** for a full-site `.zip` file, or **Export database** for a `.sql` file.
4.  Choose where to save the file.
5.  Click **Save**.

When the export is finished, WordPress Studio opens the folder that contains the backup file. You can also open the site menu by right-clicking the site in the sidebar.

## Move an export to a hosted WordPress site

<span id="how-to-upload-a-wordpress-studio-export-to-a-hosted-wordpress-site"></span>You can restore a WordPress Studio export on any WordPress site. For a site on a paid WordPress.com plan, follow [Manually Restore Your Site from a Jetpack Backup File on WordPress.com](https://developer.wordpress.com/docs/guides/manually-restore-backup/).

If the site is on a paid WordPress.com plan or on Pressable, you can [publish to it from the Publish panel](https://wordpress.studio/docs/sync/) instead, with no file to upload.

## Create a backup without Jetpack Backup

<span id="how-to-import-a-site-without-a-jetpack-backup"></span>If you don’t use Jetpack Backup, build a backup file by hand, then import it.

1.  Create a temporary import directory, for example `import-to-studio/`.
2.  Inside it, create a `sql/` directory and a `wp-content/` directory.
3.  From your site’s `wp-content/` directory, copy `plugins/`, `themes/`, and `uploads/` into the new `wp-content/` directory.
4.  Copy your site’s `wp-config.php` into the temporary import directory.
5.  Export your site’s database with a MySQL tool of your choice.
6.  Put the dump file in the `sql/` directory.
7.  Select all the files in the temporary import directory.
8.  Compress them into a `.zip` file.

The directory looks like this:

```text
import-to-studio/
├── sql/
│   └── <your-database-dump>.sql
├── wp-content/
│   ├── plugins/
│   ├── themes/
│   └── uploads/
└── wp-config.php
```

To import it, [add a new site from the backup](https://wordpress.studio/docs/import-export/#add-a-new-site-from-a-backup).

## Supported backup formats

| Format | Add a new site | Update an existing site |
| --- | --- | --- |
| Jetpack or WordPress.com backup (`.zip`) | Yes | Yes |
| `.tar` and `.tar.gz` archives | Yes | Yes |
| All-in-One WP Migration and Backup (`.wpress`), from the [plugin](https://wordpress.com/plugins/all-in-one-wp-migration) | Yes | Yes |
| [Local](https://localwp.com/help-docs/getting-started/how-to-import-a-wordpress-site-into-local/#export-a-site) export (`.zip`) | Yes | Yes |
| [WordPress Playground](https://wordpress.github.io/wordpress-playground/quick-start-guide/#save-your-site) export (`.zip`) | Yes | Yes |
| WordPress export (`.xml`), created with **Tools → Export** in WordPress admin | Yes | Yes |
| Database dump (`.sql`) | No | Yes |

A Jetpack or WordPress.com backup contains:

- `wp-config.php`, the WordPress configuration file.
- `wp-content/plugins`, your site’s plugins.
- `wp-content/themes`, your site’s themes.
- `wp-content/uploads`, your site’s uploads.
- `sql/`, the `.sql` files with your site’s database.

Exports from WordPress Studio also have a `meta.json` file, which records the site’s PHP and WordPress versions, its URL, and its plugins and themes.

## Limits

- While an import or export is running, other actions on that site, such as starting and stopping it, are unavailable.
- Exports leave out `node_modules` and `.git` paths.
- A backup opened from a website link must be a `.zip` or `.tar.gz` file smaller than 1 GB.

## Troubleshooting

### What do I do when an import fails?

WordPress Studio explains what went wrong and lets you try again. To see more detail, [open the logs](https://wordpress.studio/docs/frequently-asked-questions/#how-can-i-access-wordpress-studio-logs).

### Why can’t I add the site to this folder?

The **Site folder** for an imported site must be empty. Choose an empty folder, or type a new folder name.

### Why are thumbnails missing after an import?

Regenerate them with WordPress Studio CLI. See [How can I regenerate my thumbnails?](https://wordpress.studio/docs/frequently-asked-questions/#how-can-i-regenerate-my-thumbnails)

## Related

- [Publish and pull your site](https://wordpress.studio/docs/sync/)
- [WordPress Studio sites](https://wordpress.studio/docs/sites/)
- [WordPress Studio CLI](https://wordpress.studio/docs/cli/#import-and-export)
- [Share a preview of your site](https://wordpress.studio/docs/preview-sites/)
