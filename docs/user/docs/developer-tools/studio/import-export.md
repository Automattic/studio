# Import & export

A WordPress Studio site can be added from a backup file that contains a site’s full content.

An existing WordPress Studio site can be updated from the backup file in a similar fashion, or from a single `.sql` file, from the site menu.

Your backup files can be downloaded from your WordPress.com site or from Jetpack’s Activity Log page. It will have the following files and directories inside:

-   `wp-config.php`: The WordPress configuration file.
-   `wp-content/plugins`: The folder containing your site’s plugins.
-   `wp-content/themes`**:** The folder containing your site’s themes.
-   `wp-content/uploads`**:** The folder containing your site’s uploads.
-   `sql/`**:** A directory with `.sql` files that contain your site’s database data.

Exports from Studio will also have a `meta.json` file, which contains information about the desired PHP version for the site.

Other supported formats are:

-   The `.wpress` file from the [All-in-One WP Migration and Backup plugin](https://wordpress.com/plugins/all-in-one-wp-migration)
-   The `.zip` file from the [Local app](https://localwp.com/help-docs/getting-started/how-to-import-a-wordpress-site-into-local/#export-a-site)
-   The `.zip` file from [WordPress Playground](https://wordpress.github.io/wordpress-playground/quick-start-guide/#save-your-site)
-   Plain `.tar` archives
-   WordPress export files (`.xml`), created with **Tools → Export** in WP Admin

If your site is hosted on a paid WordPress.com plan or on [Pressable](https://pressable.com/), you can use [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/) as an alternative. It lets you pull down your production or staging site into Studio, and publish local changes back to the live site when you’re ready.

## [How to add a new site to WordPress Studio from a backup](#0-how-to-add-a-new-site-to-wordpress-studio-from-a-backup)

To add a new site to WordPress Studio from backup, you’ll need a `.tar.gz`, `.tar`, `.zip`, `.wpress`, or `.xml` file:

1.  Click the **Add site** (**+**) button next to **Sites** at the top of the Studio sidebar, and choose **Import**.
2.  Click **Choose file** and select your backup file. Alternatively, drag and drop your backup file onto the **Drop a WordPress backup here** box.
3.  Name your site and choose its local folder.
4.  Click **Import site**.

[![](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site-1.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site-1.png)

Any imported site is started by default and visible in the sidebar. If the import fails, Studio explains what went wrong in plain language and lets you try again.

## [How to update an existing WordPress Studio site from a backup](#1-how-to-update-an-existing-wordpress-studio-site-from-a-backup)

To update an existing Studio site from a backup, you’ll need a `.tar.gz`, `.tar`, `.zip`, `.wpress`, `.sql`, or `.xml` file:

1.  Open the site menu: click the site icon at the top of the chat, or right-click the site in the sidebar.
2.  Click **Import** and select your backup file.
3.  When Studio asks whether to overwrite the site, click **Import** to overwrite your Studio site with your backup file.

[![The overwrite confirmation shown when importing a backup into an existing Studio site.](https://developer.wordpress.com/wp-content/uploads/2025/01/import-overwrite-dialog.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/import-overwrite-dialog.png)

The Studio site will be replaced from the provided `.tar.gz` or `.zip` backup. However, when you import `.sql` file to an existing site, the database dump will be imported on top of the existing site.

## [How to export a site from WordPress Studio](#2-how-to-export-a-site-from-wordpress-studio)

WordPress Studio allows you to export your entire local site into a `.zip` format, which is compatible with Jetpack Backup. You may also export only the database into a `.sql` file, which is compatible with MySQL.

To export a site from Studio:

1.  Open the site menu: click the site icon at the top of the chat, or right-click the site in the sidebar.
2.  Choose **Export**, then **Export site** to generate a full-site `.zip` file, or **Export database** to generate a `.sql` file.
3.  Choose the destination and click **Save.**

[![](https://developer.wordpress.com/wp-content/uploads/2025/01/site-overview-1.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-overview-1.png)

Other site actions, such as starting and stopping the site, are unavailable while an import or export is running.

When the export is finished, Studio will open the directory containing the backup file automatically.

Note that `node_modules` and `.git` paths are excluded from the exported file.

## [How to upload a WordPress Studio export to a hosted WordPress site](#3-how-to-upload-a-wordpress-studio-export-to-a-hosted-wordpress-site)

Once you have the backup file, you can deploy it to **any** WordPress site. For example, if your site is on a paid WordPress.com plan, you can follow the [Manually Restore Your Site from a Jetpack Backup File on WordPress.com](https://developer.wordpress.com/docs/guides/manually-restore-backup/) guide.

Alternatively, if your site is hosted on a paid WordPress.com plan or Pressable, you also have the option to use [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/). Its **Publish** button lets you connect Studio to your live production or staging sites and publish local changes with a single click—no manual file upload required.

## [How to import a site without a Jetpack backup](#4-how-to-import-a-site-without-a-jetpack-backup)

If you are not using Jetpack Backup, you can still import the site to WordPress Studio from a backup file created manually:

1.  Create a temporary import directory e.g., `import-to-studio/`.
2.  Create `sql/` and `wp-content/` directories inside the created directory.
3.  Open `wp-content/` directory of your site and copy `plugins/`, `themes/`, and `uploads/` to the `wp-content/` in the temporary import directory.
4.  Copy your site’s `wp-config.php` to the temporary import directory.
5.  Export your site’s database using your favorite MySQL tool and place the dump file in `sql/` directory.
6.  Select all files in temporary import directory and compress them as `.zip` file.
7.  Follow the steps shown above to add a new site from the backup file.