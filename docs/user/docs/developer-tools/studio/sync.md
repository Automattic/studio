# Publish and pull your site

Publish your local site to a website on WordPress.com or Pressable, or pull the website’s latest version back into WordPress Studio.

To publish, connect your local site to the website, then click **Update…** in the **Publish** panel. To pull, click **Pull from live site…**. Pulling copies the website into your local site and leaves the website unchanged.

**Applies to:** the WordPress Studio app and WordPress Studio CLI, with a WordPress.com account. The website must be on a paid WordPress.com plan, or on Pressable with Jetpack enabled, and you must be an administrator of it. To publish a static copy instead, you need a Spacefast account.

In the app, publishing, pulling and [previews](https://wordpress.studio/docs/preview-sites/) all live under the **Publish** button above the site preview. To move a site to another host, [export it](https://wordpress.studio/docs/import-export/).

## Before you start

- A WordPress.com account, logged in to WordPress Studio. See [Connect to WordPress.com](https://wordpress.studio/docs/#connect-to-wordpresscom).
- A website on a paid WordPress.com plan with [its plan features activated](https://wordpress.com/support/activate-your-plan/), or a Pressable site with Jetpack Security activated and connected. Sites on the Free or Pro (legacy) plans need an [upgrade](https://wordpress.com/support/manage-purchases/upgrade-your-plan/) first.
- [Administrator](https://developer.wordpress.com/docs/platform-features/user-management/#roles) access to the website.

### Compatible sites

<span id="wordpress-studio-sync-and-jetpack-backups"></span><span id="wordpresscom-sites"></span><span id="pressable-sites"></span>Publishing and pulling rely on [Jetpack Backups](https://jetpack.com/support/backup/). The website must have one of these plugins activated and connected to WordPress.com:

- VaultPress Backup
- Jetpack Security
- Jetpack Complete

| Website | What you need to do |
| --- | --- |
| WordPress.com, paid plan | [Activate your plan features](https://wordpress.com/support/activate-your-plan/), if you haven’t. Commerce plan sites are activated automatically. |
| Pressable | Activate and connect the Jetpack Security plugin, which Pressable includes. Use the same WordPress.com account in Jetpack and in WordPress Studio, or the site won’t appear in the list of sites to connect. See the [Pressable documentation](https://pressable.com/knowledgebase/studio-for-pressable/). |

### Hosting providers

To publish from WordPress Studio, connect an account under **Hosting providers** in **Settings → Providers**. [Providers in WordPress Studio](https://wordpress.studio/docs/providers/) covers that page in full.

- **WordPress.com** publishes to a new or existing WordPress.com site, or updates a site you host on Pressable. Click **Connect** to log in with your WordPress.com account.
- **[Spacefast](https://spacefast.com)** hosts a static copy of your site. See [Publish a static copy to Spacefast](https://wordpress.studio/docs/sync/#publish-a-static-copy-to-spacefast).

**Default hosting provider** sets which provider **Destination** starts on when you publish a site you haven’t published or shared yet. You can choose another one there.

![The Destination menu open in the WordPress Studio Publish panel, with WordPress.com (The full WordPress, with a domain.), Spacefast (A static copy of your pages.), and Connect to an existing site (Publish to a site you already have.).](../../../screenshots/images/publish-destination.webp)

## Bring an existing website into WordPress Studio

<span id="bring-an-existing-wordpresscom-site-into-wordpress-studio"></span>Use this when the website isn’t in WordPress Studio yet. WordPress Studio creates a new local site and pulls the website into it.

1.  Click **Add site** (**+**) next to **Sites** at the top of the sidebar.
2.  Choose **Connect**.
3.  If you aren’t logged in, [log in to WordPress.com](https://wordpress.studio/docs/#connect-to-wordpresscom).
4.  Under **Available to connect**, click the website. Use **Search sites** to filter the list.
5.  Review the site name and site folder. The folder must be empty.
6.  Click **Add site**.

WordPress Studio creates the local site, saves the connection, and opens the site. It pulls the website into the local site in the background, and a **Pulling changes…** notification shows the progress.

Each site in the list is labeled as a WordPress.com or Pressable site, and as production, staging, or development. Sites that can’t be connected are listed under **Unavailable**, with the reason. Some entries link to WordPress.com so you can fix the problem. **View plans** appears for a site that needs a supported plan. **Enable hosting features** appears for a site that needs hosting features turned on. Click **Refresh list** to load the list again. Click **Supported sites** to see which sites you can connect.

![The Connect tab of the Add site dialog in WordPress Studio, signed in, with a Search sites field, Refresh list and Supported sites links, WordPress.com and Pressable sites listed under Available to connect, and a site listed under Unavailable.](../../../screenshots/images/add-site-connect-signed-in.webp)

To add a WordPress site that’s already on your computer instead, see [Add a new site using an existing WordPress directory](https://wordpress.studio/docs/sites/#add-a-new-site-using-an-existing-wordpress-directory).

## Connect a local site to an existing website

<span id="connect-wordpress-studio-to-an-existing-wordpresscom-site"></span>Use this when the site is already in WordPress Studio and the website already exists on WordPress.com or Pressable.

1.  In the sidebar, select the local site.
2.  Click **Publish** at the top right of the site preview.
3.  If you aren’t logged in, [log in to WordPress.com](https://wordpress.studio/docs/#connect-to-wordpresscom).
4.  Choose **Connect to an existing site**. On a site you haven’t published or shared yet, it’s an option of **Destination**. Otherwise, it’s at the bottom of the panel.
5.  In the **Choose an existing site** list, click the website.

![The Choose an existing site step of the WordPress Studio Publish panel, with a Search sites field and a Refresh list button, WordPress.com sites with their address and Production or Staging environment, and a site listed under Unavailable with the reason.](../../../screenshots/images/publish-choose-site.webp)

The list shows each site’s name, address, and whether it’s a **Production**, **Staging**, or **Development** site. Use **Search sites** to filter it, and **Refresh list** to load it again. Sites you can’t publish to, such as sites that need a plan upgrade, are listed under **Unavailable**, with the reason. To go back without connecting, click **Back**.

Connecting a website replaces the one the local site publishes to now. WordPress Studio warns you first: the website you disconnect doesn’t change.

When the local site is connected, the **Publish** panel shows the website’s details: its address with a **Site actions** (**⋯**) menu, **Who can view**, and the **Pull from live site…** and **Update…** buttons, with when you last published. Click the address to open the website.

![The Publish panel in WordPress Studio for a connected WordPress.com site, with its address and Site actions menu, Who can view set to Everyone, the Pull from live site… and Update… buttons, and Last updated on Nov 22.](../../../screenshots/images/publish-site-details.webp)

**Who can view** changes who can visit the website, right away: **Only you**, which shows visitors a Coming Soon page, or **Everyone**. **Manage on WordPress.com** opens more choices on WordPress.com. For a WordPress.com site, **Site actions** also has **Copy link**, **Manage on WordPress.com**, **Manage domains**, and **View backups**.

Teammates can connect their own local sites to the same website with the same steps.

### Choose a connected website

A local site can be connected to more than one website, for example when you pulled from a production site and its staging site. When a site has more than one website or preview, the **Publish** panel opens on **Choose a site**, which lists each website, marked **Live**, and then the site’s previews.

![The Choose a site list of the WordPress Studio Publish panel, with two connected WordPress.com sites marked Live, then Publish somewhere else and Connect to an existing site.](../../../screenshots/images/publish-sites.webp)

1.  Click a website to open its details.
2.  To go back to the list, click **Back**.

### Disconnect a website

1.  Open the website’s **Site actions** (**⋯**) menu.
2.  Choose **Disconnect site…**.
3.  Click **Disconnect site** to confirm.

Disconnecting leaves both your local site and the website unchanged.

## Publish to a new WordPress.com site

<span id="connect-wordpress-studio-to-a-new-wordpresscom-site"></span>To publish your local site to a site that doesn’t exist yet, buy a WordPress.com hosting plan from WordPress Studio. WordPress Studio connects the new site for you.

1.  In the sidebar, select the local site.
2.  Click **Publish** at the top right of the site preview.
3.  If the site already has a website or a preview, click **Publish somewhere else**.
4.  Under **Destination**, choose **WordPress.com**.
5.  Click **Launch on WordPress.com**. You can also set **Who can view** to **Everyone** and click **Continue on WordPress.com**. WordPress.com opens in your browser.
6.  Choose a domain and a plan for the new site, and complete the checkout.

![The Publish panel in WordPress Studio for a site with nothing published yet: Destination set to WordPress.com, Who can view set to Anyone with the link, and the Launch on WordPress.com and Create preview buttons.](../../../screenshots/images/publish-setup.webp)

WordPress Studio connects the new site and shows it in the **Publish** panel. If the new site isn’t available yet, WordPress Studio tells you, and you can try again.

A new site starts out unlaunched, in Coming Soon mode. The first time you publish to it, WordPress Studio also launches it, so it’s public when the publish finishes.

To make a [preview](https://wordpress.studio/docs/preview-sites/) your live site instead, see [Make a preview your live site](https://wordpress.studio/docs/preview-sites/#make-a-preview-your-live-site).

## Publish a WordPress Studio site to a WordPress.com site

Publishing replaces the parts of the website you choose with the same parts of your local site. This works for WordPress.com sites, Pressable sites, and their [staging sites](https://wordpress.com/support/how-to-create-a-staging-site/).

> **Warning:** Publishing the **Database** replaces the website’s posts, pages, and settings. On a WooCommerce site, that includes orders, product changes, and customer data. WordPress Studio starts a full site backup before it publishes. To find these backups on a WordPress.com site, open **Site actions** in the **Publish** panel and choose **View backups**.

1.  In the sidebar, select the local site.
2.  Click **Publish** at the top right of the site preview.
3.  If the local site is connected to more than one website, [choose one](https://wordpress.studio/docs/sync/#choose-a-connected-website).
4.  Click **Update…**.
5.  In **Publish changes?**, click **What to publish** and check what to send: **Everything**, or any of **Database**, **Plugins**, **Themes**, and **Uploads**.
6.  Click **Publish changes**.

![The Publish changes? dialog in WordPress Studio with What to publish open, listing Everything, Database (Posts, pages, and settings), Plugins, Themes, and Uploads, all checked, and Choose specific files, above the Cancel and Publish changes buttons.](../../../screenshots/images/publish-changes.webp)

To pick single folders and files, click **Choose specific files** under **What to publish**. In **Choose files**, expand folders such as `plugins`, `themes`, and `uploads` to pick individual items, then click **Done**.

![The Choose files dialog in WordPress Studio, listing mu-plugins, plugins, themes, upgrade, uploads, and index.php with checkboxes, themes unchecked, and a Done button.](../../../screenshots/images/publish-choose-files.webp)

A **Publishing changes…** notification shows the progress, and you can cancel from it. When the publish is done, the notification says **Changes published**. Publishing doesn’t send the `wp_users` and `wp_usermeta` tables, so Jetpack features on the website keep working. See [Why don’t my local users appear on the WordPress.com site after publishing?](https://wordpress.studio/docs/frequently-asked-questions/#why-dont-my-local-users-appear-on-the-wordpresscom-site-after-publishing)

WordPress Studio warns you before you publish when:

- You [previewed changes to this website](https://wordpress.studio/docs/preview-sites/#preview-changes-to-a-live-site) and the local site has changed since that preview was last updated. Publishing sends your current local site, including changes the preview didn’t show. You can still publish.
- Your local site is a multisite network. WordPress.com doesn’t support multisite.

### Exclude files with .deployignore

When you publish to WordPress.com or Pressable, WordPress Studio leaves out any files listed in a `.deployignore` file at the root of your site directory, for example build artifacts, vendor dependencies, or large media folders. It’s the same file previews use. See [Exclude files from a preview with .deployignore](https://wordpress.studio/docs/deployignore/) for the syntax and examples.

Even without a `.deployignore` file, publishing leaves out `.git`, `node_modules`, `.DS_Store`, and `Thumbs.db`. It also leaves out these WordPress Studio files, which shouldn’t be uploaded to the website:

```gitignore
/wp-content/database
/wp-content/db.php
debug.log
studio-error.log
sqlite-database-integration
/wp-content/cache
```

Excluded files are hidden from the file tree when you choose files to publish, and left out of the archive uploaded to the website.

## Pull a WordPress.com site into WordPress Studio

Pulling replaces the parts of your local site you choose with the same parts of the website. The website stays unchanged.

1.  In the sidebar, select the local site.
2.  Click **Publish** at the top right of the site preview.
3.  If the local site is connected to more than one website, [choose one](https://wordpress.studio/docs/sync/#choose-a-connected-website).
4.  Click **Pull from live site…**.
5.  Under **What to replace**, choose **Entire site**, **Files only**, **Content and settings only**, or **Choose files…**.
6.  Click **Replace selected content**.

![The Update local site from moirejournal.wpcomstaging.com? dialog in WordPress Studio with What to replace set to Choose files…, a file tree with themes and Content and settings checked, and Cancel and Replace selected content buttons.](../../../screenshots/images/pull-choose-files.webp)

A **Pulling changes…** notification shows the pull’s progress. It has a **Cancel** button until the pull starts changing your local site, so you can cancel from anywhere in the app. When the pull is done, the notification says **Changes pulled into** your site. If WordPress Studio couldn’t restart the site after the pull, click **Start site**.

## Publish a static copy to Spacefast

[Spacefast](https://spacefast.com) hosts static sites. WordPress Studio can turn your local site into static HTML files and publish them to a *Space*, a static site in your Spacefast account. Forms, comments, and other features that need WordPress running don’t work in the published copy.

To connect your Spacefast account:

1.  Open **Settings**.
2.  Select the **Providers** page.
3.  Under **Hosting providers**, click **Connect** next to **Spacefast**. The **Connect to Spacefast** dialog shows a sign-in code.
4.  Click **Open Spacefast**.
5.  In your browser, check that the code matches the one in WordPress Studio, and approve the connection.

Spacefast shows as **Connected**. If you need to enter the code yourself, click **Copy code**. To disconnect, click **Disconnect** next to **Spacefast**.

To publish a site to Spacefast:

1.  In the sidebar, select the local site.
2.  Click **Publish** at the top right of the site preview.
3.  If the site already has a website or a preview, click **Publish somewhere else**.
4.  Under **Destination**, choose **Spacefast**.
5.  If you haven’t connected Spacefast yet, click **Connect to Spacefast**, and approve the code in the browser window that opens.
6.  Under **Who can view**, choose **Restricted** (your team and people you give access to) or **Everyone**.
7.  Click **Publish**. WordPress Studio creates a Space named after your local site and publishes to it.

To publish to a Space you already have, choose **Connect to an existing site** instead, and pick the Space. To publish again later, click **Update** in the **Publish** panel.

Each publish replaces the Space with your site as it is now. You can’t choose what to publish, and you can’t pull from Spacefast. If the site isn’t running, WordPress Studio starts it to generate the pages, then stops it. Files named `_redirects`, `_headers`, `robots.txt`, or `llms.txt` at the root of your site folder are published as they are. The Space’s **Site actions** menu has **Copy link**, **Manage on Spacefast**, and **View versions**.

## Publish and pull from the terminal

| Command | What it does |
| --- | --- |
| `studio push` | Publishes the local site to its connected website. |
| `studio pull` | Pulls the connected website into the local site. |
| `studio push --remote-site spacefast` | Publishes the site to Spacefast. Add `:<space>` with a Space’s ID, URL, or slug to choose a Space. Without one, it publishes to the Space the site last published to. |
| `studio export-static <output-dir>` | Writes the static files to a folder instead. Run it from the site’s folder, or add `--path` with the site’s folder. |

See [Publish and pull](https://wordpress.studio/docs/cli/#publish-and-pull) in the CLI reference for all options.

## Limits

- You can publish up to 5 GB at a time to WordPress.com. If your selection is larger, WordPress Studio tells you it exceeds the 5 GB publishing limit and won’t publish until you choose fewer files, for example with **Choose specific files**. You can pull a larger site, but WordPress Studio warns you that publishing it back may fail.
- If the website doesn’t have a backup yet, such as a site on a free plan, you can pull **Entire site**, **Files only**, or **Content and settings only**. **Choose files…** is unavailable until the website has a backup.
- While a pull or publish is running, other actions on that site, such as starting and stopping it, are unavailable.
- If you quit WordPress Studio during a pull or publish, WordPress Studio warns you first. If the operation can still be cancelled, quitting cancels it. If it can no longer be stopped safely, it keeps running and shows its progress again when you relaunch WordPress Studio.

## Troubleshooting

### Why are Pull from live site… and Update… turned off?

<span id="when-you-cant-publish-or-pull"></span><span id="why-are-pull-changes-and-publish-changes-turned-off"></span>WordPress Studio turns off the buttons, and tells you why, when:

- You don’t have administrator access to the website.
- The website needs a hosting plan that supports publishing from WordPress Studio.
- Hosting isn’t fully activated yet. Finish activating hosting on WordPress.com first.
- The website has been deleted. Choose another website.
- The website isn’t a supported WordPress.com or Pressable site.
- You’re offline. Connect to the internet to publish or pull changes.
- Another operation is in progress on the site.

When you can pull but not publish, **Pull from live site…** stays available and the panel shows why publishing isn’t.

### Why doesn’t my Pressable site appear in the list?

Jetpack on the Pressable site must be activated, connected, and using the same WordPress.com account you use in WordPress Studio. See [Compatible sites](https://wordpress.studio/docs/sync/#compatible-sites).

### Why can’t I create a site from the Connect tab?

The local folder must be empty, because WordPress Studio pulls the website into it. If the folder contains files, including an existing WordPress site, WordPress Studio shows an error. Choose an empty folder.

### What if my connected website was deleted?

If a connected website was deleted, or you no longer have access to it, WordPress Studio tells you, and you can choose another website.

### Why wasn’t my new WordPress.com site launched?

If WordPress.com can’t launch the site yet, for example because your email address isn’t verified, the publish reports an error. WordPress Studio tries the launch again the next time you publish.

### What do I do when a publish or pull fails?

A **Publishing didn’t finish** or **Pulling didn’t finish** notification says what went wrong. When the website itself refused a publish, the message includes the website’s own reason, for example a missing `wp-config.php`. To see more detail, click **Open logs**, or [open the logs](https://wordpress.studio/docs/frequently-asked-questions/#how-can-i-access-wordpress-studio-logs) yourself. To try again, click **Update…** or **Pull from live site…** again.

## Related

- [Share a preview of your site](https://wordpress.studio/docs/preview-sites/)
- [Exclude files from a preview with .deployignore](https://wordpress.studio/docs/deployignore/)
- [Providers in WordPress Studio](https://wordpress.studio/docs/providers/)
- [Import & export](https://wordpress.studio/docs/import-export/)
- [WordPress Studio CLI](https://wordpress.studio/docs/cli/)
