# Studio sites

A Studio site is a WordPress instance running locally on your computer, and each of your sites will be listed in the WordPress Studio sidebar. 

WordPress Studio allows you to create, maintain, and work on **unlimited local WordPress websites**.

## [Add a new site](#0-add-a-new-site)

To add a new site to Studio:

1.  Click the **Add site** (**+**) button next to **Sites** at the top of the sidebar, or press ⌘N (Ctrl+N on Windows and Linux), to open the **Add site** dialog.
2.  The dialog lists the ways to add a site on the left: **Create**, **Connect** (see [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/)), and **Import** (see [Import & export](https://developer.wordpress.com/docs/developer-tools/studio/import-export/)), followed by the **Blueprints** categories (see [Blueprints](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/)).

<!-- TODO screenshot: replace with `add-site.png` from `npm run screenshots` (Studio 2.0): the Add site dialog. -->
[![Screenshot of the Add site dialog](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site.png)

3.  For now, stay on **Create**. Under **Choose a starting point**, click **Blank site**.
4.  On the **Create your site** screen, enter a **Site name**. You can also describe the site you want under **What should we create?**, and attach reference images or files with the **+** button. If you do, Studio creates the site and starts a Studio Code chat with your description. This requires a connected [AI provider](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/#11-ai-providers).
5.  (Optional) Expand **Advanced settings** to change the following settings:
    -   **Local path**: the folder for the site. It must be empty, or contain an existing WordPress site.
    -   **WordPress version**: keep **Auto-update** to let WordPress update itself, or pick a specific version
    -   **PHP version**
    -   **File access**: see [PHP runtimes](https://developer.wordpress.com/docs/developer-tools/studio/php-runtimes/)
    -   **Use custom domain**: see [Using a custom domain and SSL](#Using-a-custom-domain-and-SSL)
    -   **Admin username**, **Admin password**, and **Admin email**
6.  Click **Create site**.

<!-- TODO screenshot: add `create-site.png` from `npm run screenshots` (Studio 2.0) here: the Create your site screen, with Advanced settings collapsed. -->
<!-- TODO screenshot: replace with `create-site-advanced.png` from `npm run screenshots` (Studio 2.0): Create your site with Advanced settings expanded. -->
[![Screenshot of the Create your site screen](https://developer.wordpress.com/wp-content/uploads/2025/01/create-site-advanced.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/create-site-advanced.png)

Any new site is started by default and opens in the site preview.

If you always start from a blank site, open **Settings → General** and set **When adding a site** to **Start with a blank site**. **Add site** then opens straight on the **Create your site** screen.

### [Using a custom domain and SSL](#Using-a-custom-domain-and-SSL)

By default, new Studio sites use `localhost`. If you prefer to use a custom domain, expand **Advanced settings** when creating the site and turn on **Use custom domain**. Studio will suggest a domain for you but you can also enter your own. Custom domains must end in `.local`.

After clicking **Create site**, you will be prompted to enter your system password. Once confirmed, the custom domain will then point to your Studio site.

You can optionally enable HTTPS (SSL) for your custom domain. Refer to the [“SSL in Studio” doc page](https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/) to learn more about this functionality.

### [Add a new site using an existing WordPress directory](#2-add-a-new-site-using-an-existing-wordpress-directory)

You can also add a site to Studio using an existing WordPress directory:

1.  Remove `wp-config.php` file from the existing WordPress site directory.
2.  Click the **Add site** (**+**) button and choose **Blank site**.
3.  Name your site, expand **Advanced settings**, and choose the directory with the existing WordPress site as the **Local path**. Studio shows “The existing WordPress site at this path will be added.”
4.  Click **Create site**.

If you’d prefer to use an existing `wp-config.php` file, [you can follow these instructions](https://developer.wordpress.com/docs/developer-tools/studio/frequently-asked-questions/#use-studio-with-mysql-server).

## [Starting and stopping sites](#start-stop)

You can view any *running* site in your browser. With a *stopped site*, viewing the site in your browser will be disabled until you start it again.

Each site in the sidebar has a **Start** or **Stop** button next to its name. Click it to start or stop the site.

<!-- TODO screenshot: replace with `site-status-button.png` from `npm run screenshots` (Studio 2.0): the sidebar Stop button and its tooltip. -->
[![The site start and stop button in the Studio sidebar.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-status-tooltip.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-status-tooltip.png)

When a site is stopped, the site preview shows a saved image of the site, and a message that you need to start the site to see a live preview. Click the preview to start the site.

<!-- TODO screenshot: replace with `site-stopped.png` from `npm run screenshots` (Studio 2.0): a stopped site with the Start button and the saved preview image. -->
[![](https://developer.wordpress.com/wp-content/uploads/2025/01/site-stopped.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-stopped.png)

You can also start, stop, and restart a site from its [site menu](#site-menu), or press ⌥⌘S (Ctrl+Alt+S on Windows and Linux) to start or stop the active site. When several sites are running, the menu’s **Stop** submenu also offers **Stop other sites** and **Stop all sites**.

When you quit Studio while sites are running, Studio asks what to do with them. To choose a default, open **Settings → General** and set **When WordPress Studio quits** to **Keep sites running**, **Stop, restart on next launch**, or **Stop sites**.

If you send a Studio Code message to a stopped site, Studio starts it for you. To change this, turn off **Start site when sending a prompt** in **Settings → General**.

### [View sites](#4-view-sites)

The selected site is shown in the site preview, on the right of the Studio window. The preview has back, forward, and reload buttons and an address bar. Click the address bar to switch between the site’s **Front end**, **WordPress Admin**, and **Database**, or type a path on the site and press Enter.

<!-- TODO screenshot: add `preview-destinations.png` from `npm run screenshots` (Studio 2.0) here: the address bar shortcuts: Front end, WordPress Admin, Database. -->

You do not need a username or password to view your site’s dashboard in the preview, as you will be automatically logged in.

To view a running site in your browser:

-   **Open this page**: Click the arrow button at the end of the address bar to open the page shown in the preview in your browser.
-   **Open site**: Open the site menu and choose **Open in → Browser** to open your local site’s homepage. The front end opens in your external browser without logging you into WP Admin.
-   **WP Admin**: Open the site menu and choose **Open in → Browser (WP Admin)** to open your local site’s dashboard, logged in.

Links in the site preview that open a new window, such as **View post** and the editor’s **Preview**, open in the preview pane. Links to other websites open in your system browser.

To give the preview more room, click **Hide chat** (**×**) at the top of the chat. To hide the preview instead, press ⇧⌘B (Ctrl+Shift+B on Windows and Linux).

## [Site menu](#site-menu)

Each site has a menu with quick access to everything you can do with it. To open it, click the site icon at the top of the chat, or right-click the site in the sidebar.

<!-- TODO screenshot: replace with `site-menu.png` from `npm run screenshots` (Studio 2.0): the site menu. -->
[![The site menu in Studio.](https://developer.wordpress.com/wp-content/uploads/2025/01/sidebar-site-menu.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/sidebar-site-menu.png)

The site menu includes:

-   **Settings**: opens the site’s [settings](#site-settings)
-   **Start site**, or **Stop** and **Restart site**
-   **Go to**: shows **WordPress Admin**, the **Database**, or the site’s **Design system** in the site preview
-   **Open in**: opens the site in other apps (see below)
-   **Pin** or **Unpin**: keeps the site in the **Pinned** section at the top of the sidebar
-   **Rename**
-   **Import** and **Export** (**Export site** or **Export database**): see [Import & export](https://developer.wordpress.com/docs/developer-tools/studio/import-export/)
-   **Duplicate**
-   **Share**: see [Preview sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/)
-   **Publish**: see [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/)
-   **Delete site**

Site actions are also available in the command palette: press ⌘K (Ctrl+K on Windows and Linux) and start typing.

### [“Open in” menu](#6--open-in-section)

The **Open in** submenu lists the apps on your computer that can open the site:

-   **Browser** and **Browser (WP Admin)**
-   Finder (macOS), File Explorer (Windows), or your file manager (Linux)
-   Your code editor
-   Your terminal
-   phpMyAdmin

<!-- TODO screenshot: add `site-menu-open-in.png` from `npm run screenshots` (Studio 2.0) here: the site menu’s Open in submenu. -->

Studio can open sites in the following code editors:

-   Antigravity IDE
-   Cursor
-   PhpStorm
-   Sublime Text
-   Visual Studio Code
-   WebStorm
-   Windsurf
-   Zed

You can also open your sites with several terminal applications:

-   Terminal (macOS and Linux)
-   Command Prompt (Windows)
-   iTerm (macOS)
-   Warp
-   Ghostty (macOS and Linux)

To select a preferred code editor or terminal application, click **Settings** at the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux). On the **General** page, choose a **Code editor** and a **Terminal**.

<!-- TODO screenshot: replace with `settings-general.png` from `npm run screenshots` (Studio 2.0): Settings → General. -->
[![The General page of Studio's Settings, with the Code editor and Terminal options.](https://developer.wordpress.com/wp-content/uploads/2025/01/app-settings.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/app-settings.png)

## [Site settings](#site-settings)

Studio keeps the settings for the app and for each site in one **Settings** dialog. Use the **Studio** and **Site** switch at the top left to move between them, or search for a setting by name.

To open a site’s settings, choose **Settings** from the [site menu](#site-menu), or click the **Site settings** button at the start of the site preview’s address bar.

<!-- TODO screenshot: replace with `site-settings.png` from `npm run screenshots` (Studio 2.0): the Site scope Settings page. -->
[![The Settings page of a site's settings in Studio, with the site name and WordPress version settings.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings.png)

A site’s settings are grouped into these pages:

**Settings:**

-   **Site name**: Your local site’s name, as shown in Studio.
-   **WordPress version**: The WordPress release for this site. Turn on **Automatic updates** to keep WordPress updated to the latest released version.
-   **Local domain**: **Use custom domain**, **Domain**, and **Enable HTTPS**. See [Using a custom domain and SSL](#Using-a-custom-domain-and-SSL).
-   **WordPress credentials**: The **Username**, **Password**, and **Email** for the admin account, each with a copy button. You can use them to log into WP Admin on your local site and on your preview sites.

**Debug:** **Environment**, **Xdebug**, **Debug log**, **Script debugging**, and **Show errors in browser**. See [Debugging in Studio](https://developer.wordpress.com/docs/developer-tools/studio/debugging/).

**PHP:** **PHP version** and **File access**. See [PHP runtimes](https://developer.wordpress.com/docs/developer-tools/studio/php-runtimes/).

**Skills** and **Instructions:** the agent skills and instruction files installed on this site. See [Agent Skills in Studio](https://developer.wordpress.com/docs/developer-tools/studio/agent-skills-wordpress-studio/).

### [Edit a site](#8-edit-a-site)

To edit a site, change any of its settings. **Save** and **Discard** buttons appear at the top of the dialog as soon as you change something; click **Save** to apply your changes. You can edit the site’s name, switch to different PHP and WordPress versions, and change the admin credentials and domain. Saving settings doesn’t overwrite the WordPress admin email, and changing only the admin username renames the admin user. You can also change the WordPress version of a site that has never been started.

<!-- TODO screenshot: replace with `site-settings-php.png` from `npm run screenshots` (Studio 2.0): the Site scope PHP page. -->
[![The PHP page of a site's settings: PHP version and File access.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings-php.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings-php.png)

Please note that when selecting different PHP and WordPress versions, ensure they are compatible with the plugins and themes installed on your site. If you encounter any errors on your Studio site after making these changes, reviewing your active plugins and themes is a good first step in troubleshooting.

Site actions such as starting, stopping, and editing a site are unavailable while a publish, pull, import, or export is running on that site.

### [Organize the sidebar](#organize-the-sidebar)

Each site in the sidebar can be expanded to show its Studio Code chats. To keep the sidebar tidy:

-   **Pin** the sites and chats you use most, from their menus or with ⌥⌘P (Ctrl+Alt+P on Windows and Linux). They appear in the **Pinned** section at the top of the sidebar.
-   Drag sites and chats to reorder them, or use the **Sort by** menu next to **Sites** to sort sites by **Status** or **Manual order**, and chats by **Last updated** or **Manual order**.
-   ⌘-click (Ctrl-click on Windows and Linux) or Shift-click to select several sites or chats and act on them together, for example to pin, mark as read, archive, or delete them.
-   In **Settings → General**, turn on **Collapse sidebar groups** so that opening a site closes all others, or turn off **Show recent chats** to hide the **Recent** section.

### [Delete a site](#9-delete-a-site)

To delete a local site, choose **Delete site** from the [site menu](#site-menu). Studio asks you to confirm that you want to remove the site from Studio. To also delete its files from your computer, select **Also move files and database to Trash**, then click **Remove site**.

<!-- TODO screenshot: replace with `delete-site-dialog.png` from `npm run screenshots` (Studio 2.0): the Remove site confirmation. -->
[![The Delete site confirmation in Studio, with the option to move site files to the Trash.](https://developer.wordpress.com/wp-content/uploads/2025/01/delete-site-dialog.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/delete-site-dialog.png)
