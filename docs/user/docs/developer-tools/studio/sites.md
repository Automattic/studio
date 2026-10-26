# Studio sites

A Studio site is a WordPress instance running locally on your computer, and each of your sites will be listed in the WordPress Studio sidebar. 

WordPress Studio allows you to create, maintain, and work on **unlimited local WordPress websites**.

## [Add a new site](#0-add-a-new-site)

To add a new site to Studio:

1.  Click the **Add site** (**+**) button at the top of the sidebar to display the **Add a site** screen.
2.  You will be presented with three options: **Create a new site**, **Connect a site**, or **Import from a backup**. You can also choose a Blueprint under **Start from a Blueprint**; see [Blueprints](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/).

[![Screenshot of the Add a site screen](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/add-a-site.png)

3.  For now, select the **Create a new site** option.
4.  Enter a **Site name**. If you’re logged in to WordPress.com with Studio Code turned on, you can also describe the site you want under **What should we create?**: Studio creates the site and opens its chat with your description already sent.
5.  (Optional) Expand **Advanced settings** to enable the following additional settings:
    -   Select a custom local path
    -   Select a WordPress version, or keep **Automatic updates** to let WordPress update itself
    -   Select a custom PHP version
    -   Select [file access](https://developer.wordpress.com/docs/developer-tools/studio/php-runtimes/)
    -   Select admin credentials
    -   [Use a custom domain.](#Using-a-custom-domain-and-SSL)
6.  Click **Create site**.

[![Screenshot of the Create a new site screen](https://developer.wordpress.com/wp-content/uploads/2025/01/create-site-advanced.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/create-site-advanced.png)

Any new site is started by default, which is depicted by a green dot next to the site in the sidebar.

### [Using a custom domain and SSL](#Using-a-custom-domain-and-SSL)

By default, new Studio sites use `localhost`. If you prefer to use a custom domain, select **Use custom domain** under **Advanced settings → Domain** when creating the site. Studio will suggest a domain for you but you can also enter your own. Custom domains must end in `.local`.

After clicking **Create site**, you will be prompted to enter your system password. Once confirmed, the custom domain will then point to your Studio site.

You can optionally enable HTTPS (SSL) for your custom domain. Refer to the [“SSL in Studio” doc page](https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/) to learn more about this functionality.

### [Add a new site using an existing WordPress directory](#2-add-a-new-site-using-an-existing-wordpress-directory)

You can also add a site to Studio using an existing WordPress directory:

1.  Remove `wp-config.php` file from the existing WordPress site directory.
2.  Click the **Add site** (**+**) button and select **Create a new site**.
3.  Name your site, expand **Advanced settings**, choose the directory with the existing WordPress site as the **Local path**, and click **Create site**.

If you’d prefer to use an existing `wp-config.php` file, [you can follow these instructions](https://developer.wordpress.com/docs/developer-tools/studio/frequently-asked-questions/#use-studio-with-mysql-server).

## [Starting and stopping sites](#start-stop)

You can view any *running* site in your browser. With a *stopped site*, viewing the site in your browser will be disabled until you start it again.

Each site in the sidebar has a status button next to its name, which shows a green dot while the site is running. Hover over the button to see the site’s status, then click it to start or stop the site.

[![The site status button in the Studio sidebar, with its "Site status: Running" tooltip.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-status-tooltip.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-status-tooltip.png)

When a site is stopped, the site preview shows a **Start site** button, which you can also click to start it.

[![](https://developer.wordpress.com/wp-content/uploads/2025/01/site-stopped.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-stopped.png)

You can also right-click a site in the sidebar and choose **Start site** or **Stop site**.

When you quit Studio while sites are running, Studio asks what to do with them. To choose a default, open **App settings** and set **When quitting with running sites** to **Keep sites running**, **Stop, restart on next launch**, or **Stop sites**.

### [View sites](#4-view-sites)

The selected site is shown in the site preview, on the right of the Studio window. Use the preview’s address menu to switch between the site’s front end, **WP Admin**, and the database.

To view a running site in your browser:

-   **WP admin**: Click **Open in…** at the top of the window and choose **Browser (WP Admin)** to open your local site’s dashboard.
-   **Open site**: Click **Open in…** and choose **Browser**, or click **Open this page in your browser** in the site preview, to open your local site’s homepage. The front end opens in your external browser without logging you into WP Admin.

You do not need a username or password to view your site’s dashboard as you will be automatically logged in.

Links in the site preview that open a new window, such as **View post** and the editor’s **Preview**, open in the preview pane. Links to other websites open in your system browser.

## [Site overview](#site-overview)

Each local site has its own quick-access buttons on the **Overview** tab of the site overview, for easy navigation and an efficient workflow. To open it, click the **Site overview** button next to the site’s name in the sidebar.

[![The Overview tab of the site overview in Studio, with the About, WP Admin, Shortcuts, Open in…, and Manage sections.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-overview.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-overview.png)

The **Overview** tab includes:

-   **About**: a screenshot of the site, its WordPress and PHP versions, and how much disk space it uses
-   **WP Admin**: the admin username, password, and email, each with a copy button
-   **Shortcuts**: one-click links to site setting pages
-   **Open in…**: buttons that open the site in other apps
-   **Manage**: **Duplicate**, **Import**, **Export entire site**, **Export database**, and **Delete**

Select one of your sites and [make sure that it is running](#start-stop). Under **Shortcuts**, you can quickly open site setting pages with just one click. 

If you’re using a block theme on your local site, you’ll see the following options:

-   Site Editor
-   Styles
-   Patterns
-   Navigation
-   Templates

If you’re using a classic theme on your local site, you’ll see the following options, depending on their availability in the theme:

-   Customizer
-   Menus
-   Widgets

With any theme, you’ll also see **Posts**, **Pages**, and **Media Library**.

### [“Open in…” section](#6--open-in-section)

Under the “**Open in…**” heading, Studio will show buttons that will open your site in the following apps if detected on your computer:

-   Finder (macOS only)
-   File Explorer (Windows only)
-   File manager (Linux only)

Additionally, Studio allows opening files in the following code editors:

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

Studio also allows you to open your site’s database with the database editor:

-   phpMyAdmin

To select a preferred code editor or terminal application, click **App settings** at the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux). On the **Settings** tab, choose a **Preferred editor** and a **Preferred terminal**.

[![The Settings tab of Studio's App settings, with the Preferred editor and Preferred terminal options.](https://developer.wordpress.com/wp-content/uploads/2025/01/app-settings.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/app-settings.png)

## [Site settings](#site-settings)

You can view and edit each site’s settings on the **Settings** tab of the site overview. To open it, click the **Site overview** button next to the site’s name in the sidebar and select the **Settings** tab, or right-click the site in the sidebar and choose **Site settings**.

[![The Settings tab of the site overview in Studio, with the site name and WordPress version settings.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings.png)

**Site details:**

-   **Site name**: Your local site’s name.
-   **WordPress version**: Keep **Automatic updates** to let WordPress install updates on its own schedule, or choose **Select a version** to pin a specific WordPress version.

**PHP environment:**

-   **PHP version**: The PHP version used for your local site.
-   **File access**: See [PHP runtimes in Studio](https://developer.wordpress.com/docs/developer-tools/studio/php-runtimes/).

**WordPress admin:**

-   **Admin username**: The username for the admin account on your local site and can be used to log into your preview site. 
-   **Admin password**: The password for the admin account on your local site and can be used to log into your preview site. 
-   **Admin email**: The email address for the admin account.

**Domain:**

-   **Use custom domain** and **Enable HTTPS**: See [Using a custom domain and SSL](#Using-a-custom-domain-and-SSL).

### [Edit a site](#8-edit-a-site)

To edit a site, change any of the settings on the **Settings** tab and click **Save settings**. You can edit the site’s name, switch to different PHP and WordPress versions, and change the admin credentials and domain. Saving settings doesn’t overwrite the WordPress admin email, and changing only the admin username renames the admin user. You can also change the WordPress version of a site that has never been started.

[![The PHP environment settings on the site's Settings tab: PHP version and File access.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings-php.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings-php.png)

Please note that when selecting different PHP and WordPress versions, ensure they are compatible with the plugins and themes installed on your site. If you encounter any errors on your Studio site after making these changes, reviewing your active plugins and themes is a good first step in troubleshooting.

Site actions such as starting, stopping, and editing a site are unavailable while a sync, import, or export is running on that site.

### [Site menu](#site-menu)

Right-click a site in the sidebar to open its menu, with quick access to:

-   **Start site** or **Stop site**
-   **Site settings**
-   **Duplicate site**
-   **Open in** your browser (the site or WP Admin), file manager, editor, terminal, or phpMyAdmin
-   **Export entire site** and **Export database**
-   **Delete site**

[![The site menu in the Studio sidebar.](https://developer.wordpress.com/wp-content/uploads/2025/01/sidebar-site-menu.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/sidebar-site-menu.png)

### [Delete a site](#9-delete-a-site)

You may also delete your local site by clicking **Delete** under **Manage** on the site overview’s **Overview** tab, or by right-clicking the site in the sidebar and choosing **Delete site**. You’ll have the option to delete site files from your computer before confirming the deletion with **Delete site**.

[![The Delete site confirmation in Studio, with the option to delete site files from your computer.](https://developer.wordpress.com/wp-content/uploads/2025/01/delete-site-dialog.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/delete-site-dialog.png)
