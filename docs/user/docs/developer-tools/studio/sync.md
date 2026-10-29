# Studio Sync

Studio Sync lets you publish your WordPress Studio sites to a production or staging site, and pull changes from that site back into Studio. In the app, these actions live under the **Publish** button above the site preview. This guide explains how to connect, publish, and pull sites.

This feature is available for all WordPress.com sites on paid plans and [Pressable sites](https://pressable.com/knowledgebase/studio-for-pressable/) with Jetpack enabled.

If you’re on a WordPress.com plan, [make sure to activate your plan features](https://wordpress.com/support/activate-your-business-plan/). Commerce plan sites are automatically activated. For sites on the Free or Pro (legacy) plans, [upgrade your plan](https://wordpress.com/support/manage-purchases/upgrade-your-plan/) to access Studio Sync.

## [Compatible sites](#supported-sites)

### [Studio Sync and Jetpack Backups](#1-studio-sync-and-jetpack-backups)

Studio Sync relies on [Jetpack Backups](https://jetpack.com/support/backup/) to operate. To enable this, your site must have one of the following plugins activated and connected to WordPress.com:

-   VaultPress Backup
-   Jetpack Security
-   Jetpack Complete

Studio Sync supports sites up to 5GB in size. If your selection exceeds this limit, Studio asks you to choose fewer files. You can still publish specific portions of your site ([see below](#push)) as long as the total size of the selected content is under 5GB.

### [WordPress.com sites](#2-wordpress-com-sites)

You can use Studio’s syncing feature on sites with a paid WordPress.com plan — no additional setup is required.

### [Pressable sites](#3-pressable-sites)

The Jetpack Security plugin is included on Pressable sites, but you’ll need to activate and connect it manually. To sync a Pressable site with WordPress Studio, make sure you use the same WordPress.com account in both Studio and Jetpack on the Pressable site. If the accounts don’t match, the site won’t appear as an option to connect in Studio.

For detailed instructions on how to use Studio with Pressable sites, please refer to the [Pressable documentation](https://pressable.com/knowledgebase/studio-for-pressable/).

## [Bring an existing WordPress.com site into WordPress Studio](#connect-add-site)

To start working locally on a WordPress.com or Pressable site you don’t have in Studio yet:

1.  Click the **Add site** (**+**) button next to **Sites** at the top of the sidebar, and choose **Connect**.
2.  [Log in to WordPress.com](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com) if you haven’t already.
3.  Select the site you want to work on. Each site is labeled as a WordPress.com or Pressable site, and as production or staging. Sites that can’t be connected are listed separately, with the reason.
4.  Review the site name and local folder, and click **Create site**.

Studio creates the local site, saves the connection, and pulls the live site into it.

<!-- TODO screenshot: add `add-site-connect.webp` from `npm run screenshots` (Studio 2.0) here: Add site → Connect, logged out. -->
<!-- TODO screenshot: capture by hand in Studio 2.0, logged in to WordPress.com: Add site → Connect, listing WordPress.com and Pressable sites. -->

## [Connect WordPress Studio to an existing WordPress.com site](#connect-existing)

You can connect your Studio sites with any WordPress.com-hosted sites [for which you are an Administrator](https://developer.wordpress.com/docs/platform-features/user-management/#roles) and synchronize the content in either direction. Studio will save the connection details, so you can easily pull your site from WordPress.com and then publish the changes you made in Studio back to the original site.

To connect a local Studio site to an existing production or staging site on WordPress.com:

1.  Select the site you wish to connect from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview. You can also choose **Publish** from the site menu.
3.  [Log in to WordPress.com](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com) if you haven’t already.
4.  Click **Use an existing website…** to open the **Choose website** list. Each site is labeled as a WordPress.com or Pressable site, and as staging or development where that applies.
5.  Click the site you want to connect to.

<!-- TODO screenshot: capture by hand in Studio 2.0, logged in to WordPress.com: the Publish panel’s Choose website list, with WordPress.com and Pressable sites. -->
[![A screenshot depicting the list that allows you to connect a local Studio site to a production or staging site on WordPress.com or Pressable.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-connect-live-site.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-connect-live-site.png)

Once connected, the **Publish** panel shows the website you’ll publish to and when you last published. A local site can be connected to more than one website. To see them all, open the **Website actions** (**⋯**) menu in the **Publish** panel and choose **Manage websites…**. From there, you can **Disconnect** a website, or connect another one with **Use another website…**.

If a connected site was deleted, or you no longer have access to it, Studio tells you, and you can choose another website.

If you’re working in a team, your teammates can repeat the same steps to collaborate on the same site.

## [Connect WordPress Studio to a new WordPress.com site](#connect-new)

If you’d like to publish your local site to a new WordPress.com-hosted site, you can purchase a WordPress.com hosting plan and set up Studio Sync all at once:

1.  Select the site you wish to publish from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview.
3.  Click **Publish on WordPress.com** to add a new site in the browser. If the local site is already connected to a website, open **Website actions** (**⋯**) → **Manage websites…** and click **Create a new WordPress.com site** instead.
4.  Select a plan for a new site and complete the checkout.
5.  When the new site is added, accept the prompt to open Studio or click “**Connect Studio**” on your site’s Home screen.

Studio saves the connection to let you easily synchronize the Studio site with the connected WordPress.com site in either direction.

## [Pull a WordPress.com site into WordPress Studio](#pull)

To bring the latest changes from your production or [staging site](https://wordpress.com/support/how-to-create-a-staging-site/) into Studio:

1.  Select the site you wish to synchronize from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview, and connect a website if you haven’t already.
3.  Open the **Website actions** (**⋯**) menu and choose **Pull changes…**. You can also choose **Publish → Pull changes…** from the site menu.

<!-- TODO screenshot: capture by hand in Studio 2.0, logged in to WordPress.com: Pull changes with Include → Choose files…. -->
[![A screenshot depicting the selective Pull process in Studio Sync.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-pull-selective.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-pull-selective.png)

4.  Under **Include**, choose what to pull:
    -   **Files, content, and settings**
    -   **Files only**
    -   **Content and settings only**
    -   **Choose files…**: pick individual items. You can expand the `plugins`, `themes`, and `uploads` folders to select individual items, and choose whether to include **Content and settings** (the database).
5.  Click **Pull changes**.

While a pull or publish is running, other site actions, such as starting and stopping the site, are unavailable for that site. The **Publish** button shows the transfer’s progress, and you can cancel it from the **Publish** panel.

If you quit Studio while a pull or publish is running, Studio warns you first. If the operation can still be cancelled, quitting aborts it. If it can no longer be stopped safely, it keeps running after you quit Studio and appears again in the **Publish** panel when you relaunch Studio.

The selected elements of the Studio site will be replaced by the files (like plugins or themes) and content (like media files and the database) from the remote site. Your website stays unchanged. When the pull is done, Studio shows “Changes pulled into WordPress Studio”. You can work on your site locally now, and publish it back to the live site anytime.

## [Publish a WordPress Studio site to a WordPress.com site](#push)

When you are happy with the changes made to your Studio site, you can publish them to your WordPress.com site or [staging site](https://wordpress.com/support/how-to-create-a-staging-site/):

1.  Select the site you wish to publish from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview, and connect a website if you haven’t already.
3.  If the local site is connected to more than one website, choose one under **Publish to**.

<!-- TODO screenshot: capture by hand in Studio 2.0, logged in to WordPress.com: the Publish panel with Include → Choose files…. -->
[![The Publish panel with "Choose files…" selected](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-selective-push.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-selective-push.png)

4.  Under **Include**, choose what to publish:
    -   **Files, content, and settings**
    -   **Files only**
    -   **Content and settings only**
    -   **Choose files…**: pick individual items. You can expand the `plugins`, `themes`, and `uploads` folders to select individual items, and choose whether to include **Content and settings** (the database).
5.  Click **Publish**.

The selected elements of your WordPress.com site will be replaced by the files (like plugins or themes) and content (like media files and the database) from the Studio site. The **Publish** panel tells you what will be overwritten before you start.

Note that publishing content and settings will replace the whole database of your live site. If it’s a WooCommerce site, it would include orders, product changes, and customer data. Studio triggers a full site backup before syncing so you can restore your site if you are not happy with the result, but use it with extra caution. To find these backups, open **Website actions** (**⋯**) in the **Publish** panel and choose **View backups**.

### [Exclude files with .deployignore](#8-exclude-files-with-deployignore)

When publishing a Studio site to WordPress.com or Pressable, Studio honors the same `.deployignore` file [used by Preview Sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/#4-exclude-files-with-deployignore). Place a `.deployignore` file at the root of your site directory to exclude files from the publish — for example, build artifacts, vendor dependencies, or large media folders.

The file uses the same .gitignore-style syntax. See the [Preview Sites documentation](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/#4-exclude-files-with-deployignore) for the full syntax reference and examples.

In addition to the defaults applied by Preview Sites (`.git`, `node_modules`, `.DS_Store`, `Thumbs.db`), Sync also excludes Studio-internal files that  
shouldn’t be uploaded to the remote site:

database
db.php
debug.log
sqlite-database-integration
cache

Excluded files are hidden from the file tree when you choose files to publish, and omitted from the archive uploaded to the remote site.
