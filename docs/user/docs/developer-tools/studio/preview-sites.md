# Preview sites in WordPress Studio

With WordPress Studio, you can share your work with preview sites. These preview sites are powered by [WordPress.com](https://wordpress.com/?ref=dev-doc) on a temporary domain (wp.build), and they allow you to share snapshots of your local sites with clients or team members. 

You can create up to ten preview sites at a time per WordPress.com account, and you can see how many you’re using in **Settings → Sharing** and **Settings → Usage** within the WordPress Studio app.

While preview sites are intended for sharing with clients and gathering early feedback for up to seven days, a hosting plan is required to make your site permanently accessible. Use [Publish](https://developer.wordpress.com/docs/developer-tools/studio/sync/) or [Import/Export](https://developer.wordpress.com/docs/developer-tools/studio/import-export/) to move your Studio site to a hosting plan.

## [Create a preview site](#0-create-a-preview-site)

To create a preview site: 

1.  Select the local site within Studio.
2.  Click **Share** at the top right of the site preview. You can also choose **Share** from the site menu.
3.  [Log in to WordPress.com](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com) if you haven’t already.
4.  Under **Share a preview**, click **Create preview**. The button shows **Creating preview…** while Studio builds the preview.

<!-- TODO screenshot: replace with `share-create-preview.webp` from `npm run screenshots` (Studio 2.0, signed-in suite): Share and publish → Share, with Share a preview and Create preview. -->
[![A screenshot depicting the Share panel in the Studio app.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-site-new-preview-1.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-site-new-preview-1.png)

Your preview site should be ready to view in a few seconds, and it will be available to access publicly for seven days. You can close the panel while you wait. The **Share** button shows a spinner while a preview is being created or updated, and a dot when the preview is ready. Studio also shows a notification when the preview is ready, with a **Copy link** button.

The **Share** panel lists the site’s previews, newest first. Each one shows its name and when it expires. Click a preview’s name to open it in your browser. Open its **Preview actions** (**⋯**) menu to:

-   **Update** the preview with your latest local changes.
-   **Copy link** to the preview.
-   **Visit preview** in your browser.
-   **Rename** the preview.
-   **Delete preview**.

To create another preview of the same site, click **Create another preview** below the list.

Studio can’t create or update a preview when:

-   You’ve used all the preview sites available on your account. Delete a preview to make room. You can still copy and update your existing previews.
-   Preview sites aren’t available for your account.
-   You’re offline. Connect to the internet to create or update a preview.
-   Another operation is running on the site. Wait for it to finish before creating or updating a preview.

<!-- TODO screenshot: replace with `share-previews.webp` from `npm run screenshots` (Studio 2.0, signed-in-previews suite): the Share panel with previews in the list, and Create another preview. -->
[![A screenshot depicting an existing preview in the Share panel in the Studio app.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-new-site-preview-link.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-new-site-preview-link.png)

## [Rename a preview site](#1-rename-a-preview-site)

You can create multiple preview sites per Studio site. To differentiate between them you can rename them inside Studio. To do so follow these steps:

1.  Select the local site within Studio, and click **Share**.
2.  Open the **Preview actions** (**⋯**) menu next to the preview you want to rename, and choose **Rename**.
3.  In the **Rename preview** dialog, enter a new name.
4.  Click **Save**.

<!-- TODO screenshot: replace with `share-preview-actions.webp` from `npm run screenshots` (Studio 2.0, signed-in-previews suite): the Share panel’s Preview actions menu, with Update, Copy link, Visit preview, Rename, and Delete preview. -->
[![A screenshot depicting the Preview actions menu, with the options to create, rename, or delete a preview.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-preview-more-actions.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-preview-more-actions.png)

Your preview site will display that name in Studio, while your remote preview site name will remain unchanged.

You can also rename any of your previews in **Settings → Sharing**.

## [Delete a preview site](#2-delete-a-preview-site)

To delete a preview site: 

1.  Select the local site within Studio, and click **Share**.
2.  Open the **Preview actions** (**⋯**) menu next to the preview you want to delete, and choose **Delete preview**.
3.  In the **Delete preview?** dialog, click **Delete preview** to confirm.

Your preview site will be deleted, and its shared link will stop working. You can also delete any of your previews in **Settings → Sharing**.

## [Update your preview site](#3-update-your-preview-site)

By design, preview sites are generated as one-time “snapshots” of your work. That said, you may synchronize local site changes with your preview site: 

1.  Select the local site within Studio, and click **Share**.
2.  Open the **Preview actions** (**⋯**) menu next to the preview you want to update, and choose **Update**.

Your preview site will be updated with the local changes in a few seconds. While it updates, the **Share** button shows a spinner. This will also reset the preview site expiration date back to seven days.

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

Expired previews no longer appear in the **Share** panel. To see them, open **Settings → Sharing** and click **Show expired previews (N)**, where N is the number of expired previews. They’re listed under **Expired previews**. Click **Remove expired preview** next to one to remove it from the list. To share the site again, create a new preview from the **Share** panel.

## [Manage all your preview sites](#manage-all-preview-sites)

**Settings → Sharing** lists the live previews of all your sites under **Live previews**, and how many of your preview sites you’ve used. For each preview, you can click its address to open it, see when it expires, and **Copy link**, **Rename preview**, or **Delete preview**. If you don’t have any live previews, the page shows **Share a preview of your site** instead.

<!-- TODO screenshot: replace with `settings-sharing.webp` from `npm run screenshots` (Studio 2.0, signed-in suite): Settings → Sharing; also consider `settings-usage.webp`, Settings → Usage with Preview sites. -->
[![Screenshot of the Sharing page of Studio's Settings](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-delete-all-preview-sites.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-delete-all-preview-sites.png)

## [Delete all preview sites](#6-delete-all-preview-sites)

To quickly delete all of your preview sites within Studio:

1.  Click **Settings** at the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux).
2.  Select the **Usage** page. You can also open it by choosing **Usage** from the account menu. The **Preview sites** section shows how many active preview sites you have, for example “3 of 10 active preview sites”.
3.  Open the **Preview site actions** (**⋯**) menu, click **Delete all preview sites**, and confirm.
