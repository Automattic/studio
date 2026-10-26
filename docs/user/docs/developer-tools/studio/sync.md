# Studio Sync

The Studio Sync feature allows you to synchronize a production or staging site with your WordPress Studio sites in either direction. This guide explains how to connect, pull, and push sites using Studio Sync.

This feature is available for all WordPress.com sites on paid plans and [Pressable sites](https://pressable.com/knowledgebase/studio-for-pressable/) with Jetpack enabled.

If you’re on a WordPress.com plan, [make sure to activate your plan features](https://wordpress.com/support/activate-your-business-plan/). Commerce plan sites are automatically activated. For sites on the Free or Pro (legacy) plans, [upgrade your plan](https://wordpress.com/support/manage-purchases/upgrade-your-plan/) to access Studio Sync.

## [Compatible sites](#supported-sites)

### [Studio Sync and Jetpack Backups](#1-studio-sync-and-jetpack-backups)

Studio Sync relies on [Jetpack Backups](https://jetpack.com/support/backup/) to operate. To enable this, your site must have one of the following plugins activated and connected to WordPress.com:

-   VaultPress Backup
-   Jetpack Security
-   Jetpack Complete

Studio Sync supports sites up to 5GB in size. If your site exceeds this limit, you’ll see a warning in the app. You can still sync specific portions of your site ([see below](#push)) as long as the total size of the selected content is under 5GB.

### [WordPress.com sites](#2-wordpress-com-sites)

You can use Studio’s syncing feature on sites with a paid WordPress.com plan — no additional setup is required.

### [Pressable sites](#3-pressable-sites)

The Jetpack Security plugin is included on Pressable sites, but you’ll need to activate and connect it manually. To sync a Pressable site with WordPress Studio, make sure you use the same WordPress.com account in both Studio and Jetpack on the Pressable site. If the accounts don’t match, the site won’t appear as an option to connect in Studio.

For detailed instructions on how to use Studio with Pressable sites, please refer to the [Pressable documentation](https://pressable.com/knowledgebase/studio-for-pressable/).

## [Connect WordPress Studio to an existing WordPress.com site](#connect-existing)

You can connect your Studio sites with any WordPress.com-hosted sites [for which you are an Administrator](https://developer.wordpress.com/docs/platform-features/user-management/#roles) and synchronize the content in either direction. Studio will save the connection details, so you can easily pull your site from WordPress.com and then push the changes you made in Studio back to the original site.

To connect a local Studio site to an existing production or staging site on WordPress.com:

1.  Select the site you wish to connect from the Studio sidebar.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Live sites** section.
3.  [Log in to WordPress.com](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com) if you haven’t already.
4.  Click **Connect site** to open the **Connect a live site** list. Each site is labeled as a WordPress.com or Pressable site.
5.  Click the site you want to connect to.

[![A screenshot depicting the list that allows you to connect a local Studio site to a production or staging site on WordPress.com or Pressable.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-connect-live-site.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-connect-live-site.png)

Once connected, the site appears in the **Live sites** section with **Pull from live** and **Push to live** buttons. Every live site connected to the local site is listed there, and each one shows when it was last pulled and pushed. To remove a connection, open the site’s **More actions** menu and click **Disconnect**.

A connected site shows its current name, URL and sync status. If a connected site was deleted, or you no longer have access to it, it is labeled **Unavailable site** (“Deleted, or you no longer have access”) and its **Pull from live** and **Push to live** buttons are hidden. You can still disconnect it.

If you’re working in a team, your teammates can repeat the same steps to collaborate on the same site.

## [Connect WordPress Studio to a new WordPress.com site](#connect-new)

If you’d like to push your local site to a new WordPress.com-hosted site or [staging site](https://wordpress.com/support/how-to-create-a-staging-site/), you can purchase a WordPress.com hosting plan and set up Studio Sync all at once:

1.  Select the site you wish to connect from the Studio sidebar.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Live sites** section.
3.  Click **Connect site**, then click **Create a new WordPress.com site** at the bottom of the list to add a new site in the browser.
4.  Select a plan for a new site and complete the checkout.
5.  When the new site is added, accept the prompt to open Studio or click “**Connect Studio**” on your site’s Home screen.

Studio saves the connection to let you easily synchronize the Studio site with the connected WordPress.com site in either direction.

## [Pull a WordPress.com site into WordPress Studio](#pull)

To start working on your WordPress.com site locally, first, ensure that you pull your production or [staging site](https://wordpress.com/support/how-to-create-a-staging-site/) to Studio:

1.  Select the site you wish to synchronize from the Studio sidebar.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Live sites** section.
3.  Locate the connected WordPress.com site or connect to another one.
4.  Click **Pull from live** to open the sync dialog.

[![A screenshot depicting the selective Pull process in Studio Sync.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-pull-selective.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-pull-selective.png)

5.  Choose to sync **“All files and folders”** or **“Specific files and folders”**.
6.  Select the elements you want to synchronize to your production or staging environment. You can expand the `plugins`, `themes`, and `uploads` folders to select individual items.
7.  Decide whether to include the **Database** in the sync.
8.  Confirm the pull by clicking **Pull from Production** (or **Pull from Staging**).

While a pull or push is running, other site actions, such as starting and stopping the site, are unavailable for that site.

If you quit Studio while a pull or push is running, Studio warns you first. If the operation can still be cancelled, quitting aborts it. If it can no longer be stopped safely, it keeps running after you quit Studio and appears again in the **Live sites** section when you relaunch Studio.

The Studio site will be replaced by the selected elements (like plugins or themes) and content (like media files and the database) from the remote WordPress.com. You can work on your site locally now, and the Studio site will be ready to be pushed to the live site anytime.

## [Push a WordPress Studio site to a WordPress.com site](#push)

When you are happy with the changes made to your Studio site, you can synchronize local changes to your WordPress.com site or [staging site](https://wordpress.com/support/how-to-create-a-staging-site/):

1.  Select the site you wish to synchronize from the Studio sidebar.
2.  Click the site’s name at the top of the chat to open the site menu, and find the **Live sites** section.
3.  Locate the connected WordPress.com site or connect to another one.
4.  Click **Push to live** to open the sync dialog.

[![Push dialog with "Specific files and folders" selected](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-selective-push.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-selective-push.png)

5.  Choose to sync **“All files and folders”** or **“Specific files and folders”**.
6.  Select the elements you want to synchronize to your production or staging environment. You can expand the `plugins`, `themes`, and `uploads` folders to select individual items.
7.  Decide whether to include the **Database** in the sync.
8.  Confirm the push by clicking **Push to Production** (or **Push to Staging**).

The selected elements of your WordPress.com site will be replaced by the files (like plugins or themes) and content (like media files and the database) from the Studio site.

Note that the syncing process will replace the whole database of your live site. If it’s a WooCommerce site, it would include orders, product changes, and customer data. Studio triggers a full site backup before sync so you can restore your site if you are not happy with the sync result, but use it with extra caution.

### [Exclude files with .deployignore](#8-exclude-files-with-deployignore)

When pushing a Studio site to WordPress.com or Pressable, Studio honors the same `.deployignore` file [used by Preview Sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/#4-exclude-files-with-deployignore). Place a `.deployignore` file at the root of your site directory to exclude files from the push — for example, build artifacts, vendor dependencies, or large media folders.

The file uses the same .gitignore-style syntax. See the [Preview Sites documentation](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/#4-exclude-files-with-deployignore) for the full syntax reference and examples.

In addition to the defaults applied by Preview Sites (`.git`, `node_modules`, `.DS_Store`, `Thumbs.db`), Sync also excludes Studio-internal files that  
shouldn’t be uploaded to the remote site:

database
db.php
debug.log
sqlite-database-integration
cache

Excluded files are hidden from the file tree in the Sync dialog and omitted from the archive uploaded to the remote site.