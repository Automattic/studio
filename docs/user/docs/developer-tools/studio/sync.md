# Studio Sync

Studio Sync lets you publish your WordPress Studio sites to a production or staging site, and pull changes from that site back into Studio. In the app, these actions live under the **Publish** button above the site preview. This guide explains how to connect, publish, and pull sites.

This feature is available for all WordPress.com sites on paid plans and [Pressable sites](https://pressable.com/knowledgebase/studio-for-pressable/) with Jetpack enabled.

If you’re on a WordPress.com plan, [make sure to activate your plan features](https://wordpress.com/support/activate-your-plan/). Commerce plan sites are automatically activated. For sites on the Free or Pro (legacy) plans, [upgrade your plan](https://wordpress.com/support/manage-purchases/upgrade-your-plan/) to access Studio Sync.

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
3.  Select the site you want to work on. Use **Search sites** to filter the list, or **Refresh list** to load it again. Each site is labeled as a WordPress.com or Pressable site, and as production, staging, or development. Sites you can connect are listed under **Available to connect**. Sites that can’t be connected are listed under **Unavailable**, with the reason. Where it helps, a link takes you to WordPress.com to fix it: **View plans** for a site that needs a supported plan, or **Enable hosting features** for a site that needs hosting features turned on. **Supported sites** explains which sites you can connect.
4.  Review the site name and local folder, and click **Create site**.

Studio creates the local site, saves the connection, and opens the site. The live site is pulled into it in the background, and the **Publish** panel shows the pull’s progress.

[![The Connect tab of the Add site dialog in WordPress Studio, signed out, titled Connect to an existing WordPress, with Create account and Log in options to connect WordPress.com or Pressable sites.](https://developer.wordpress.com/wp-content/uploads/2025/01/add-site-connect.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/add-site-connect.webp)
[![The Connect tab of the Add site dialog in WordPress Studio, signed in, with a Search sites field, Refresh list and Supported sites links, WordPress.com and Pressable sites listed under Available to connect, and a site listed under Unavailable.](https://developer.wordpress.com/wp-content/uploads/2025/01/add-site-connect-signed-in.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/add-site-connect-signed-in.webp)

## [Connect WordPress Studio to an existing WordPress.com site](#connect-existing)

You can connect your Studio sites with any WordPress.com-hosted sites [for which you are an Administrator](https://developer.wordpress.com/docs/platform-features/user-management/#roles) and synchronize the content in either direction. Studio will save the connection details, so you can easily pull your site from WordPress.com and then publish the changes you made in Studio back to the original site.

To connect a local Studio site to an existing production or staging site on WordPress.com:

1.  Select the site you wish to connect from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview. You can also choose **Publish** from the site menu.
3.  [Log in to WordPress.com](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com) if you haven’t already.
4.  Click **Existing site…** to open the **Choose an existing site** list. Each row shows the site’s name, its address, and whether it’s a **Production**, **Staging**, or **Development** site. Sites you can’t publish to, such as sites that need a plan upgrade, deleted sites, or sites you don’t have permission to manage, are left out. To load the list again, open **Site actions** (**⋯**) and choose **Refresh**.
5.  Click the site you want to connect to. To go back without connecting, click **Back to Publish**.

[![The Publish tab of the Share and Publish panel in WordPress Studio for a site that isn't connected yet, titled Publish your WordPress, with Existing site… and New site… buttons.](https://developer.wordpress.com/wp-content/uploads/2025/01/publish-panel.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/publish-panel.webp)

[![The Choose an existing site list in the WordPress Studio Publish panel, showing each site's name, address, and Production or Staging environment, with a back button and a Site actions menu.](https://developer.wordpress.com/wp-content/uploads/2025/01/publish-choose-site.webp?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/publish-choose-site.webp)

Once connected, the **Publish** panel shows **Publish details**: a card for the website you’ll publish to, with its address and when you last published (or **Not published yet**). Below the card, you’ll see the website’s **Environment** and, once you’ve pulled from it, when it was **Last pulled**. For WordPress.com sites, there are also links to the site’s **Domains**, **Backups**, and **Manage on WordPress.com**.

Open the **Website actions** (**⋯**) menu on the card to **Visit site**, **Copy link**, or **Disconnect…** the website. Disconnecting asks you to confirm, and leaves both your local site and the live website unchanged.

If a connected site was deleted, or you no longer have access to it, Studio tells you, and you can choose another website.

If you’re working in a team, your teammates can repeat the same steps to collaborate on the same site.

### [Switch websites](#switch-websites)

A local site can be connected to more than one website, for example a production site and its staging site. To switch between them:

1.  In the **Publish** panel, click the website card.
2.  Choose another connected website. The current one is listed first.

The details, links, and the **Pull changes** and **Publish changes** buttons follow the website you choose. To connect one more website, click the card and choose **Connect another site…**. You can’t switch websites while a pull or publish is running.

<!-- TODO screenshot: add `publish-switcher.webp` from `npm run screenshots` (Studio 2.0, signed-in-connected suite) here: the Publish panel’s website switcher open, listing two connected websites and Connect another site…. -->

## [Connect WordPress Studio to a new WordPress.com site](#connect-new)

If you’d like to publish your local site to a new WordPress.com-hosted site, you can purchase a WordPress.com hosting plan and set up Studio Sync all at once:

1.  Select the site you wish to publish from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview. If the local site isn’t connected to a website yet, you’ll see **Existing site…** and **New site…**.
3.  Click **New site…** to set up a new site on WordPress.com in your browser.
4.  Choose a domain and a plan for the new site, and complete the checkout.
5.  When the new site is added, accept the prompt to open Studio or click “**Connect Studio**” on your site’s Home screen.

Studio connects the new site automatically and shows it in the **Publish** panel, so you can synchronize the Studio site with the connected WordPress.com site in either direction. If the new site isn’t available yet, Studio tells you, and you can try again.

## [Pull a WordPress.com site into WordPress Studio](#pull)

To bring the latest changes from your production or [staging site](https://wordpress.com/support/how-to-create-a-staging-site/) into Studio:

1.  Select the site you wish to synchronize from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview, and connect a website if you haven’t already. If the local site is connected to more than one website, [choose one](#switch-websites).
3.  Click **Pull changes**.

<!-- TODO screenshot: replace with `pull-choose-files.webp` from `npm run screenshots` (Studio 2.0, signed-in-connected suite): the Pull changes review step with Choose files… selected. -->
[![A screenshot depicting the selective Pull process in Studio Sync.](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-pull-selective.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-pull-selective.png)

4.  Choose what to pull:
    -   **Entire site**
    -   **Files only**
    -   **Content and settings only**
    -   **Choose files…**: pick individual items. You can expand folders such as `plugins`, `themes`, and `uploads` to select individual items, and choose whether to include **Content and settings** (the database).
5.  Click **Pull changes**.

If the website doesn’t have a backup yet, only a full-site pull is available.

While a pull or publish is running, other site actions, such as starting and stopping the site, are unavailable for that site. The **Publish** button shows the transfer’s progress, and you can cancel it from the **Publish** panel.

If you quit Studio while a pull or publish is running, Studio warns you first. If the operation can still be cancelled, quitting aborts it. If it can no longer be stopped safely, it keeps running after you quit Studio and appears again in the **Publish** panel when you relaunch Studio.

The selected elements of the Studio site will be replaced by the files (like plugins or themes) and content (like media files and the database) from the remote site. Your website stays unchanged. When the pull is done, Studio shows “Changes pulled into WordPress Studio” and “Your website wasn’t changed.” Click **Done** to go back to **Publish details**. If Studio couldn’t restart the site after the pull, click **Start site**. You can work on your site locally now, and publish it back to the live site anytime.

If a pull fails, Studio shows what went wrong, and you can click **Try pulling again**.

## [Publish a WordPress Studio site to a WordPress.com site](#push)

When you are happy with the changes made to your Studio site, you can publish them to your WordPress.com site or [staging site](https://wordpress.com/support/how-to-create-a-staging-site/):

1.  Select the site you wish to publish from the Studio sidebar.
2.  Click **Publish** at the top right of the site preview, and connect a website if you haven’t already.
3.  If the local site is connected to more than one website, [choose one](#switch-websites). Then click **Publish changes**.

<!-- TODO screenshot: replace with `publish-choose-files.webp` from `npm run screenshots` (Studio 2.0, signed-in-connected suite): the Publish changes review step with Choose files… selected. -->
[![Push dialog with "Specific files and folders" selected](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-selective-push.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/studio-selective-push.png)

4.  Choose what to publish:
    -   **Entire site**
    -   **Files only**
    -   **Content and settings only**
    -   **Choose files…**: pick individual items. You can expand folders such as `plugins`, `themes`, and `uploads` to select individual items, and choose whether to include **Content and settings** (the database).
5.  Click **Publish changes**.

The selected elements of your WordPress.com site will be replaced by the files (like plugins or themes) and content (like media files and the database) from the Studio site. The review step tells you what will be overwritten before you start. If publishing fails, Studio shows what went wrong, and you can click **Try publishing again**.

Note that publishing content and settings will replace the whole database of your live site. If it’s a WooCommerce site, it would include orders, product changes, and customer data. Studio triggers a full site backup before syncing so you can restore your site if you are not happy with the result, but use it with extra caution. To find these backups on a WordPress.com site, click **Backups** in the **Publish** panel.

### [When you can’t publish or pull](#cant-publish-or-pull)

Studio disables **Pull changes** and **Publish changes**, and tells you why, when:

-   You don’t have administrator access to the website.
-   The website needs a hosting plan that supports publishing from WordPress Studio.
-   Hosting isn’t fully activated yet. Finish activating hosting on WordPress.com first.
-   The website has been deleted. Choose another website.
-   You’re offline. Connect to the internet to publish or pull changes.

### [Exclude files with .deployignore](#11-exclude-files-with-deployignore)

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
