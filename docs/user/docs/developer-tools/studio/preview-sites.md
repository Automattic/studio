# Preview sites in WordPress Studio

With WordPress Studio, you can share your work with preview sites. These preview sites are powered by [WordPress.com](https://wordpress.com/?ref=dev-doc) on a temporary domain (wp.build), and they allow you to share snapshots of your local sites with clients or team members. 

You can create up to ten preview sites at a time per WordPress.com account, and you can view the total number of preview sites you have associated with your account in **App settings → Usage** within the WordPress Studio app.

While preview sites are intended for sharing with clients and gathering early feedback for up to seven days, a hosting plan is required to make your site permanently accessible. Use the [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/) or [Import/Export](https://developer.wordpress.com/docs/developer-tools/studio/import-export/) features to connect your Studio site to a hosting plan.

## [Create a preview site](#0-create-a-preview-site)

To create a preview site: 

1.  Select the local site within Studio.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Previews** section.
3.  [Log in to WordPress.com](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com) if you haven’t already.
4.  Click on the **New preview** button.

[![A screenshot depicting the Previews section of the site menu in the Studio app.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-site-new-preview-1.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-site-new-preview-1.png)

Your preview site should be ready to view in a few seconds, and it will be available to access publicly for seven days.

Every preview site for the local site is listed in the **Previews** section. Click a preview’s address to open it in your browser, or click **Copy preview URL** to share it.

[![A screenshot depicting the existing previews in the Previews section of the site menu in the Studio app.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-new-site-preview-link.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-new-site-preview-link.png)

## [Rename a preview site](#1-rename-a-preview-site)

You can create multiple preview sites per Studio site. To differentiate between them you can rename them inside Studio. To do so follow these steps:

1.  Select the local site within Studio.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Previews** section.
3.  Click the **More actions** button in the row of your preview site.
4.  Click on the **Rename** button.
5.  Enter a new name.
6.  Click the **Save name** button.

[![A screenshot depicting more actions option of preview sites with the ability to rename or delete a site.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-preview-more-actions.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-preview-more-actions.png)

Your preview site will display that name in the list of preview sites, while your remote preview site name will remain unchanged.

## [Delete a preview site](#2-delete-a-preview-site)

To delete a preview site: 

1.  Select the local site within Studio.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Previews** section.
3.  Click the **More actions** button in the row of your preview site.
4.  Click on the **Delete** button, then click **Delete** again to confirm.

Your preview site will be deleted and removed from the list.

## [Update your preview site](#3-update-your-preview-site)

By design, preview sites are generated as one-time “snapshots” of your work. That said, you may synchronize local site changes with your preview site: 

1.  Select the local site within Studio.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Previews** section.
3.  Click the **Update preview site** button in the row of your preview site.

Your preview site will be updated with the local changes in a few seconds. This will also reset the preview site expiration date back to seven days.

## [Exclude files with .deployignore](#4-exclude-files-with-deployignore)

When creating or updating a preview site, Studio uploads the contents of your site’s `wp-content` directory. If your site contains files you don’t want included — such as build artifacts, vendor dependencies, or large media folders — you can create a `.deployignore` file at the root of your site directory to exclude them.

The `.deployignore` file uses the same pattern syntax as `.gitignore`. For example:

\# Exclude vendor dependencies
wp-content/plugins/my-plugin/vendor

# Exclude all log files
\*.log

# Exclude old uploads
wp-content/uploads/2024

# Exclude a specific plugin
wp-content/plugins/wordpress-seo

You can also use negation patterns to re-include specific items:

\# Exclude vendor, but keep important-lib
wp-content/plugins/my-plugin/vendor/\*
!wp-content/plugins/my-plugin/vendor/important-lib

Note: Patterns are relative to the site root directory, not to `wp-content`. The following directories are excluded by default, even without a `.deployignore` file: `.git`, `node_modules`, `.DS_Store`, and `Thumbs.db`.

## [Preview site expiration](#5-preview-site-expiration)

Preview sites are temporary, and each preview site will be **automatically deleted after seven days from the last update**. This feature ensures that preview environments are used for short-term feedback and review purposes.

An expired preview stays in the **Previews** list, marked as expired. Click **Recreate preview** to publish it again from your local site, or **Remove expired preview** to remove it from the list.

## [Delete all preview sites](#6-delete-all-preview-sites)

To quickly delete all of your preview sites within Studio:

1.  Click **App settings** at the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux).
2.  Select the **Usage** tab. The **Preview sites** section shows how many active preview sites you have.
3.  Click the **Delete all preview sites** button and confirm.

[![Screenshot of the App Settings -> Usage tab and the Delete all preview sites button](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-delete-all-preview-sites.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-delete-all-preview-sites.png)