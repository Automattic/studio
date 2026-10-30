# WordPress Studio: Frequently asked questions

On this page you’ll find answers to common questions about the [WordPress Studio](https://developer.wordpress.com/studio/) app and certain features like the [Studio Code](#studio-code) and [Studio Sync.](#sync)

As a reminder, WordPress Studio is an [open source project](https://github.com/Automattic/studio) that welcomes all contributions. If you spot a bug or the Studio feature you need is missing, we have some options:

-   [Reach out to our Happiness Engineers](https://developer.wordpress.com/contact/) for specific questions about using Studio.
-   [Open an issue in the repository](https://github.com/Automattic/studio/issues) to report bugs, suggest ideas, or request new features.

## [General FAQs](#0-general-faqs)

Here are some answers to common questions about WordPress Studio:

### [How can I export a theme I created in WordPress Studio?](#export-theme)

Themes created in Studio are the same as themes created on traditional WordPress sites. You can export your theme by following these steps:

1.  Select the local site within Studio.
2.  Ensure that your site is already running.
3.  Click the site preview’s address bar and choose **WordPress Admin**.
4.  In WP Admin, go to **Appearance → Editor**.
5.  Once the site editor loads, expand the editor by clicking anywhere on the site preview.
6.  Click the **Options** menu button in the top right of the screen, represented by the ellipsis icon (⋮). 
7.  Click **Export**, and your browser should begin downloading a `.zip` file of your theme.

You can then upload your theme to any live or staging WordPress site [by following these instructions](https://wordpress.com/support/themes/uploading-setting-up-custom-themes/#upload-a-theme-file).

### [How can I publish my Studio site so that it’s publicly available?](#12-how-can-i-publish-my-studio-site-so-that-it-s-publicly-available-)

While [preview sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites) are intended for sharing with clients and gathering early feedback for up to seven days, a hosting plan is required to make your site permanently accessible.

**To publish your local site on WordPress.com**, follow the steps outlined in the [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/) doc.

**To publish your local site on another WordPress host**, follow the [Import and Export](https://developer.wordpress.com/docs/developer-tools/studio/import-export) guide to create an export of your source site. When the export is ready, you can import that content to the destination site, for example, following the [Manually Restore Your Site from a Jetpack Backup File on WordPress.com](https://developer.wordpress.com/docs/guides/manually-restore-backup/) guide.

### [How can I manage the Studio site’s SQLite database?](#13-how-can-i-manage-the-studio-site-s-sqlite-database-)

WordPress Studio uses SQLite instead of MySQL server. SQLite is a lightweight, self-contained SQL database engine that stores your database in a single file. Each of your sites will have a database file available in the following path: `wp-content/database/.ht.sqlite`.

We discourage editing this SQLite file directly using third-party tools like a terminal client or a standalone SQLite GUI app. Direct edits can be risky — it’s easy to corrupt the file, break WordPress’s expected schema, or end up with a database that isn’t portable if you later migrate to MySQL.

Instead, Studio includes a built-in phpMyAdmin interface, adapted to work safely with SQLite while preserving the familiar phpMyAdmin experience. This is the recommended way to browse tables, run queries, and edit your site’s database.

#### Using phpMyAdmin

1.  Select the local site within Studio.
2.  Open the site menu: click the **Site menu** button at the top left of the site’s header, or right-click the site in the sidebar.
3.  Choose **Open in → phpMyAdmin**.
4.  Studio will open phpMyAdmin in your browser, connected directly to your site’s database.

You can also open phpMyAdmin inside Studio: click the site preview’s address bar and choose **Database**, or choose **Go to → Database** from the site menu.

From there, you can browse tables, inspect data, run SQL queries, and make edits through a familiar, safe interface — without needing to touch the underlying `.ht.sqlite` file directly.

<!-- TODO screenshot: add `preview-destinations.webp` from `npm run screenshots` (Studio 2.0) here: the address bar shortcuts, with Database. -->

### [How can I use Studio with the MySQL server of my choice?](#use-studio-with-mysql-server)

WordPress Studio has built-in support for a SQLite database, but you can use the MySQL server of your choice, e.g., Homebrew or Docker, to test your site with different database engines.

If you have a local site already configured to work with a custom MySQL server of your choice, you can add it to Studio. If the site files include a `wp-config.php` file, Studio will skip the SQLite database setup and use the already configured database.

If you have already created a site in Studio, and want to switch SQLite to the MySQL server of your choice, follow the steps below:

1.  Stop the site.
2.  Open your Studio’s site directory.
3.  Navigate to the `wp-content` directory and delete the `db.php` file and the `database` directory.
4.  Navigate to the `wp-content/mu-plugins` directory and delete the `sqlite-database-integration` directory.
5.  Update `wp-config.php` file and fill in your MySQL server’s credentials.
6.  Start your MySQL server.
7.  Start the Studio’s site.
8.  Open the site.

### [How do I select the PHP and WordPress versions for my site?](#15-how-do-i-change-the-php-version-used-for-my-site-) 

You can select the PHP version or the WordPress version for your site when you first create it. This option is located in the “**Advanced Settings**” section. After creating a site, the current PHP and WordPress versions are displayed in the site’s settings, where you can also edit and change them.

1.  Choose **Settings** from the site menu: click the **Site menu** button at the top left of the site’s header, or right-click the site in the sidebar.
2.  On the **Settings** page, choose a **WordPress version**, or turn on **Automatic updates** to keep WordPress on the latest release.
3.  On the **PHP** page, select the **PHP version**.
4.  Click **Save** at the top of the dialog to persist the changes.  

### [Why isn’t the “Open In” button available for my preferred app?](#16-why-isn-t-the-open-in-button-available-for-my-preferred-app-)

For each of your local sites, the following options are available under **Open in** in the site menu:

<!-- TODO screenshot: add `site-menu-open-in.webp` from `npm run screenshots` (Studio 2.0) here: the site menu’s Open in submenu. -->

#### File browsers

-   Finder (for macOS)
-   File Explorer (for Windows)
-   File manager (for Linux)

#### Code editors

-   Antigravity IDE
-   Cursor
-   Visual Studio Code
-   PhpStorm
-   Sublime Text
-   WebStorm
-   Windsurf
-   Zed

#### Terminal applications

-   Terminal (for macOS)
-   iTerm (for macOS)
-   Warp (for macOS, Windows, and Linux)
-   Command Prompt (for Windows)
-   Ghostty (for macOS and Linux)

#### Browser

-   Browser (the site’s front end)
-   WordPress admin

#### Database administration tools

-   phpMyAdmin

On macOS, the code editors and terminal applications must live in your Applications folder (`/Applications` or `~/Applications`) to appear in the **Open in** menu. On Windows, Studio looks for them in their usual install folders, and on Linux, on your `PATH`. If you haven’t chosen a **Code editor** in **Settings → General**, the **Open in** menu uses the first supported editor installed on your computer; with none installed, no code editor appears. Similarly, if no **Terminal** is selected, the default will be:

-   **Terminal** on macOS
-   **Command Prompt** on Windows
-   The system terminal on Linux, such as GNOME Terminal or Konsole

### [How can I make Studio faster on Windows?](#17-how-can-i-make-studio-faster-on-windows-)

If the Real-Time Protection Service of Windows Defender is enabled on your machine, it may slow down the process of creating and starting a site, particularly when running PHP files of WordPress.

This is why WordPress Studio prompts you to “speed up site creation” when you create your first site, so an exclusion policy can be added to the Real-Time Protection Service.

You can add this exclusion policy manually by choosing **Help → How can I make WordPress Studio faster?** in Studio. This menu item is only available on Windows.

### [How can I regenerate my thumbnails?](#18-how-can-i-regenerate-my-thumbnails-)

If some thumbnails are missing after importing your site, you can regenerate them by first [installing the Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/#0-installation), and then running the following CLI command:

```shell
studio wp media regenerate --yes --only-missing
```

### [How can I access Studio logs?](#access-logs)

Occasionally, actions like publishing or pulling changes, or Import and Export, could fail due to different reasons related to PHP, the site’s database, or custom code issue.

If this happens, WordPress Studio will allow you to open logs and may ask to [contact support](https://developer.wordpress.com/contact/). You can also open the current log file from **Help → Open Application Logs**, or open the logs folder manually.

If you use Studio on Mac:

1.  Open Terminal.
2.  Enter command:  
    open `~/Library/Logs/Studio`
3.  Locate the latest log file and open it.

If you use Studio on Windows:

1.  Open Terminal.
2.  Enter command:  
    `ii AppData\Roaming\Studio\logs`
3.  Locate the latest log file and open it.

If you use Studio on Linux, the logs are in `~/.config/Studio/logs`.

### [Where do emails sent by my site go?](#site-email)

Studio saves every email a local site sends, such as password reset emails and form notifications, instead of delivering it. To see them, choose **Go to → Email** from the site menu: click the **Site menu** button at the top left of the site’s header, or right-click the site in the sidebar. The site’s email folder opens in Finder, File Explorer, or your file manager.

Each email is saved as an `.eml` file, which opens in any mail app, in `~/.studio/email/<site id>/`. Studio keeps the newest 100 emails for each site, and deletes the folder when you delete the site. `studio status` shows the folder as **Email**. Because the folder is outside the site directory, email is never pushed or synced with your site.

### [Is it possible to change the port or URL of my Studio site?](#10-is-it-possible-to-change-the-port-or-url-of-my-studio-site-)

By default, Studio sites are assigned a unique port starting from 8881. For example, your first Studio site uses the URL `http://localhost:8881`, and your second site uses `http://localhost:8882`. While the port of `localhost` URLs cannot be modified from Studio, you can always [use a custom domain instead of `localhost`](https://developer.wordpress.com/docs/developer-tools/studio/sites/#Using-a-custom-domain-and-SSL).

### [How can I use a tunneling tool (ngrok) with Studio?](#11-how-can-i-use-a-tunneling-tool-ngrok-with-studio-)

You can use WordPress Studio for local WordPress development that requires incoming connections by setting up a tunneling tool like [ngrok](https://ngrok.com/). ngrok, which is free to use, redirects external requests to your localhost, making your site accessible from the internet. This is especially useful for plugins like Jetpack, which default to offline mode when running locally. By using a tunneling tool, your local site can reconnect to WordPress.com, which unlocks the full capabilities of Jetpack and creates a more realistic development environment.

Follow the steps below to set up your site for this workflow. Begin by starting your local Studio site and setting up the tunneling tool.

If your site uses a local domain in the form of localhost:port:

1.  **Start your Studio site** and note its port (e.g., `8883`). The port is shown in the site preview’s address bar.
2.  **Open a terminal** and set up [ngrok](https://dashboard.ngrok.com/get-started/setup) if you haven’t already.
3.  **Set up a tunnel** to expose your local site using the following command:  
    `ngrok http 8883`

 If your site uses a custom local domain:

1.  **Start your Studio site** and note the domain (e.g., `my-wordpress-website.wp.local`). The domain can also be found under **Local domain** on the **Settings** page of the site’s settings.
2.  **Open a terminal** and set up [ngrok](https://dashboard.ngrok.com/get-started/setup) if you haven’t already.
3.  **Set up a tunnel** to expose your local site using the following command:  
    `ngrok http --host-header=my-wordpress-website.wp.local http://my-wordpress-website.wp.local`

When your tunnel is active, make sure to note the tunnel URL and update it in your Studio site’s WordPress configuration file.

1.  **Copy the generated tunnel URL**. It will look something like this:  
    `https://6xb2-12-13-14-15.ngrok-free.app`
2.  **Update your WordPress configuration** (`wp-config.php`) by adding:  
    `define( 'WP_SITEURL', 'https://6xb2-12-13-14-15.ngrok-free.app' );`  
    `define( 'WP_HOME', 'https://6xb2-12-13-14-15.ngrok-free.app' );`
3.  **Refresh your site** in the browser.

Your local Studio site should now be accessible through the tunnel URL. If it doesn’t redirect automatically, clearing your browser cache may help. You can also access the site directly by using the generated tunnel URL. 

The local URL shown in Studio will not update to reflect the new tunnel URL, and since the ngrok URL changes each time you restart the tunnel, you will need to update the `wp-config.php` file accordingly.

To reset your local site, stop the tunnel in the terminal and shut down the Studio site. Then, remove the changes made to `wp-config.php` and restart your Studio site. It will now revert to the localhost or custom domain shown under **Local domain** on the **Settings** page of the site’s settings.

### [How can I export my site for use on the WordPress playground website?](#12-how-can-i-export-my-site-for-use-on-the-wordpress-playground-website-)

To import your local site to [playground.wordpress.net](https://playground.wordpress.net/), create a ZIP file from the contents of your site folder and use the [Site Explorer](https://wordpress.github.io/wordpress-playground/web-instance#1-site-explorer) to import the ZIP in your browser.

**Please note** that top-level entries like `wp-config.php` should live at the root of the archive. To accomplish this, select all files and directories inside the site folder when creating the ZIP file instead of the site folder itself.

## [Studio Code FAQs](#studio-code)

Here are some answers to common questions about the Studio Code. Please review [the Studio Code doc](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/) for step-by step instructions and helpful tips for using this feature.

### [What languages does the Studio Code support?](#3-where-do-the-assistant-s-answers-come-from-)

You can talk with Studio Code in any language you prefer.

### [Can I use the Studio Code without a WordPress.com account?](#5-can-i-use-the-studio-assistant-without-a-wordpress-com-account-)

Yes, with your own Anthropic API key. Connect **Anthropic** in **Settings → AI Providers** in the desktop app, or use the `/api-key` command in the terminal. Usage is billed through your Anthropic account. See [Use your own Anthropic API key](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/#use-your-own-anthropic-api-key).

To use WordPress.com AI credits instead, [log into Studio with your WordPress.com account](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com). Some features, such as [image generation](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/image-generation/), preview sites, and publishing to WordPress.com, also need a WordPress.com login.

### [Is there any cost to use the Studio Code?](#6-is-there-any-cost-to-use-the-studio-assistant-)

Studio Code uses AI Credits to pay for AI usage. Every account starts with a one-time free allowance of AI Credits, which can be used with the Fast tier. To keep using Studio Code after that, or to use the Balanced and Strong tiers, you’ll need to buy AI Credits. See [How AI Credits Work](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/) for details.

### [How many prompts can I use per month?](#7-how-many-prompts-can-i-use-per-month-)

AI responses pause until you add more AI Credits. Your local sites keep running normally. You can buy more AI Credits from inside Studio Code, or use your own Anthropic API key instead. Usage through your own key is billed by Anthropic and doesn’t use AI Credits.

### [Where can I give feedback about the Studio Code responses?](#8-where-can-i-give-feedback-about-the-studio-assistant-s-responses-)

You can [write into support](https://developer.wordpress.com/contact/) to share specific feedback about the Studio Code responses. 

## [Studio Sync FAQs](#sync)

Here are some answers to common questions about the Studio Sync feature. Please review [the Studio Sync doc](https://developer.wordpress.com/docs/developer-tools/studio/sync/) for step-by step instructions and helpful tips for using this feature.

### [Why don’t my local users appear on the WordPress.com site after pushing?](#local-users)

When pushing, WordPress Studio exports all your content and your entire database except for the `wp_users` and `wp_usermeta` tables. This ensures that the Jetpack-powered features on your WordPress.com website (like single sign-on or image optimization) continue working after the push.