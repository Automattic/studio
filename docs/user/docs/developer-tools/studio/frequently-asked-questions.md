# WordPress Studio: Frequently asked questions

On this page you’ll find answers to common questions about the [WordPress Studio](https://developer.wordpress.com/studio/) app and certain features like the [WordPress Studio Code](#studio-code) and [WordPress Studio Sync.](#sync)

As a reminder, WordPress Studio is an [open source project](https://github.com/Automattic/studio) that welcomes all contributions. If you spot a bug or the WordPress Studio feature you need is missing, we have some options:

-   [Reach out to our Happiness Engineers](https://developer.wordpress.com/contact/) for specific questions about using WordPress Studio.
-   [Open an issue in the repository](https://github.com/Automattic/studio/issues) to report bugs, suggest ideas, or request new features.

## [General FAQs](#0-general-faqs)

Here are some answers to common questions about WordPress Studio:

### [How can I export a theme I created in WordPress Studio?](#export-theme)

Themes created in WordPress Studio are the same as themes created on traditional WordPress sites. You can export your theme by following these steps:

1.  Select the local site within WordPress Studio.
2.  Ensure that your site is already running.
3.  Click the site preview’s address bar and choose **WordPress Admin**.
4.  In WP Admin, go to **Appearance → Editor**.
5.  Once the site editor loads, expand the editor by clicking anywhere on the site preview.
6.  Click the **Options** menu button in the top right of the screen, represented by the ellipsis icon (⋮). 
7.  Click **Export**, and your browser should begin downloading a `.zip` file of your theme.

You can then upload your theme to any live or staging WordPress site [by following these instructions](https://wordpress.com/support/themes/uploading-setting-up-custom-themes/#upload-a-theme-file).

### [How can I publish my WordPress Studio site so that it’s publicly available?](#12-how-can-i-publish-my-studio-site-so-that-it-s-publicly-available-)

While [preview sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites) are intended for sharing with clients and gathering early feedback for up to seven days, a hosting plan is required to make your site permanently accessible.

**To publish your local site on WordPress.com**, follow the steps outlined in the [WordPress Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/) doc.

**To publish your local site on another WordPress host**, follow the [Import and Export](https://developer.wordpress.com/docs/developer-tools/studio/import-export) guide to create an export of your source site. When the export is ready, you can import that content to the destination site, for example, following the [Manually Restore Your Site from a Jetpack Backup File on WordPress.com](https://developer.wordpress.com/docs/guides/manually-restore-backup/) guide.

### [How can I manage the WordPress Studio site’s SQLite database?](#13-how-can-i-manage-the-studio-site-s-sqlite-database-)

WordPress Studio uses SQLite instead of a MySQL server. Each site’s database is a single file, `wp-content/database/.ht.sqlite`. Avoid editing that file with other tools, such as a terminal client or a SQLite app: it’s easy to corrupt it, break the schema WordPress expects, or end up with a database that won’t move to MySQL later.

Use WordPress Studio’s built-in phpMyAdmin instead, adapted to work safely with SQLite. In the [site menu](https://developer.wordpress.com/docs/developer-tools/studio/sites/#site-menu), choose **Open in → phpMyAdmin** to open it in your browser, or **Tools → Database** to open it in the site preview. There you can browse tables, run queries and edit data.

### [How can I use WordPress Studio with the MySQL server of my choice?](#use-studio-with-mysql-server)

WordPress Studio has built-in support for a SQLite database, but you can use the MySQL server of your choice, e.g., Homebrew or Docker, to test your site with different database engines.

If you have a local site already configured to work with a custom MySQL server of your choice, you can add it to WordPress Studio. If the site files include a `wp-config.php` file, WordPress Studio will skip the SQLite database setup and use the already configured database.

If you have already created a site in WordPress Studio, and want to switch SQLite to the MySQL server of your choice, follow the steps below:

1.  Stop the site.
2.  Open your WordPress Studio’s site directory.
3.  Navigate to the `wp-content` directory and delete the `db.php` file and the `database` directory.
4.  Navigate to the `wp-content/mu-plugins` directory and delete the `sqlite-database-integration` directory.
5.  Update `wp-config.php` file and fill in your MySQL server’s credentials.
6.  Start your MySQL server.
7.  Start the WordPress Studio’s site.
8.  Open the site.

### [How do I select the PHP and WordPress versions for my site?](#15-how-do-i-change-the-php-version-used-for-my-site-) 

Choose them when you create the site, on the form where you name it. To change them later, choose **Settings** from the site menu: the **WordPress version** is on the **Settings** page, and the **PHP version** on the **PHP** page. Click **Save** at the top of the dialog to apply the change. See [Edit a site](https://developer.wordpress.com/docs/developer-tools/studio/sites/#10-edit-a-site).

### [Why isn’t the “Open In” button available for my preferred app?](#16-why-isn-t-the-open-in-button-available-for-my-preferred-app-)

The **Open in** menu only lists apps WordPress Studio supports and finds on your computer. [“Open in” menu](https://developer.wordpress.com/docs/developer-tools/studio/sites/#8--open-in-menu) lists the supported code editors and terminal applications.

-   On macOS, an editor or terminal must be in your Applications folder (`/Applications` or `~/Applications`).
-   On Windows, WordPress Studio looks in each app’s usual install folder.
-   On Linux, the app must be on your `PATH`.

If you haven’t chosen a **Default code editor** in **Settings → General**, the menu shows the first supported editor it finds, and no editor if none is installed. Without a **Default terminal app**, it uses Terminal on macOS, Command Prompt on Windows, and your system terminal, such as GNOME Terminal or Konsole, on Linux.

### [How can I make WordPress Studio faster on Windows?](#17-how-can-i-make-studio-faster-on-windows-)

If the Real-Time Protection Service of Windows Defender is enabled on your machine, it may slow down the process of creating and starting a site, particularly when running PHP files of WordPress.

This is why WordPress Studio prompts you to “speed up site creation” when you first open it on Windows, so an exclusion policy can be added to the Real-Time Protection Service.

You can add this exclusion policy manually by choosing **Help → How can I make WordPress Studio faster?** in WordPress Studio. This menu item is only available on Windows.

### [How can I regenerate my thumbnails?](#18-how-can-i-regenerate-my-thumbnails-)

If some thumbnails are missing after importing your site, you can regenerate them by first [installing the WordPress Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/#0-installation), and then running the following CLI command:

```shell
studio wp media regenerate --yes --only-missing
```

### [How can I access WordPress Studio logs?](#access-logs)

When publishing, pulling, importing or exporting fails, WordPress Studio offers to open its logs, and may ask you to [contact support](https://developer.wordpress.com/contact/). You can also open the current log file at any time by choosing **Help → Open Application Logs**. The logs folder is:

-   macOS: `~/Library/Logs/Studio`
-   Windows: `%APPDATA%\Studio\logs`
-   Linux: `~/.config/Studio/logs`

### [Where do emails sent by my site go?](#site-email)

WordPress Studio saves them instead of sending them. To see them, choose **Tools → Email** from the site menu, which opens the site’s email folder. See [Site email](https://developer.wordpress.com/docs/developer-tools/studio/sites/#site-email).

### [Is it possible to change the port or URL of my WordPress Studio site?](#10-is-it-possible-to-change-the-port-or-url-of-my-studio-site-)

By default, WordPress Studio sites are assigned a unique port starting from 8881. For example, your first WordPress Studio site uses the URL `http://localhost:8881`, and your second site uses `http://localhost:8882`. While the port of `localhost` URLs cannot be modified from WordPress Studio, you can always [use a custom domain instead of `localhost`](https://developer.wordpress.com/docs/developer-tools/studio/sites/#Using-a-custom-domain-and-SSL).

### [How can I use a tunneling tool (ngrok) with WordPress Studio?](#11-how-can-i-use-a-tunneling-tool-ngrok-with-studio-)

You can use WordPress Studio for local WordPress development that requires incoming connections by setting up a tunneling tool like [ngrok](https://ngrok.com/). ngrok, which is free to use, redirects external requests to your localhost, making your site accessible from the internet. This is especially useful for plugins like Jetpack, which default to offline mode when running locally. By using a tunneling tool, your local site can reconnect to WordPress.com, which unlocks the full capabilities of Jetpack and creates a more realistic development environment.

Follow the steps below to set up your site for this workflow. Begin by starting your local WordPress Studio site and setting up the tunneling tool.

If your site uses a local domain in the form of localhost:port:

1.  **Start your WordPress Studio site** and note its port (e.g., `8883`). The port is shown in the site preview’s address bar.
2.  **Open a terminal** and set up [ngrok](https://dashboard.ngrok.com/get-started/setup) if you haven’t already.
3.  **Set up a tunnel** to expose your local site using the following command:  
    `ngrok http 8883`

 If your site uses a custom local domain:

1.  **Start your WordPress Studio site** and note the domain (e.g., `my-wordpress-website.wp.local`). The domain can also be found under **Local domain** on the **Settings** page of the site’s settings.
2.  **Open a terminal** and set up [ngrok](https://dashboard.ngrok.com/get-started/setup) if you haven’t already.
3.  **Set up a tunnel** to expose your local site using the following command:  
    `ngrok http --host-header=my-wordpress-website.wp.local http://my-wordpress-website.wp.local`

When your tunnel is active, make sure to note the tunnel URL and update it in your WordPress Studio site’s WordPress configuration file.

1.  **Copy the generated tunnel URL**. It will look something like this:  
    `https://6xb2-12-13-14-15.ngrok-free.app`
2.  **Update your WordPress configuration** (`wp-config.php`) by adding:  
    `define( 'WP_SITEURL', 'https://6xb2-12-13-14-15.ngrok-free.app' );`  
    `define( 'WP_HOME', 'https://6xb2-12-13-14-15.ngrok-free.app' );`
3.  **Refresh your site** in the browser.

Your local WordPress Studio site should now be accessible through the tunnel URL. If it doesn’t redirect automatically, clearing your browser cache may help. You can also access the site directly by using the generated tunnel URL. 

The local URL shown in WordPress Studio will not update to reflect the new tunnel URL, and since the ngrok URL changes each time you restart the tunnel, you will need to update the `wp-config.php` file accordingly.

To reset your local site, stop the tunnel in the terminal and shut down the WordPress Studio site. Then, remove the changes made to `wp-config.php` and restart your WordPress Studio site. It will now revert to the localhost or custom domain shown under **Local domain** on the **Settings** page of the site’s settings.

### [How can I export my site for use on the WordPress playground website?](#12-how-can-i-export-my-site-for-use-on-the-wordpress-playground-website-)

To import your local site to [playground.wordpress.net](https://playground.wordpress.net/), create a ZIP file from the contents of your site folder and use the [Site Explorer](https://wordpress.github.io/wordpress-playground/web-instance#1-site-explorer) to import the ZIP in your browser.

**Please note** that top-level entries like `wp-config.php` should live at the root of the archive. To accomplish this, select all files and directories inside the site folder when creating the ZIP file instead of the site folder itself.

## [WordPress Studio Code FAQs](#studio-code)

Here are some answers to common questions about WordPress Studio Code. Please review [the WordPress Studio Code doc](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/) for step-by step instructions and helpful tips for using this feature.

### [What languages does WordPress Studio Code support?](#3-where-do-the-assistant-s-answers-come-from-)

You can talk with WordPress Studio Code in any language you prefer.

### [Can I use WordPress Studio Code without a WordPress.com account?](#5-can-i-use-the-studio-assistant-without-a-wordpress-com-account-)

Yes, with your own Anthropic API key. Connect **Anthropic** in **Settings → AI Providers** in the desktop app, or use the `/api-key` command in the terminal. Usage is billed through your Anthropic account. See [Use your own Anthropic API key](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/#use-your-own-anthropic-api-key).

To use WordPress.com AI credits instead, [log into WordPress Studio with your WordPress.com account](https://developer.wordpress.com/docs/developer-tools/studio#connect-wordpress-com). Some features, such as [image generation](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/image-generation/), preview sites, and publishing to WordPress.com, also need a WordPress.com login.

### [Is there any cost to use WordPress Studio Code?](#6-is-there-any-cost-to-use-the-studio-assistant-)

WordPress Studio Code runs on AI Credits. Every account starts with a free allowance for the Fast tier; after that, or to use Balanced and Strong, you buy more. With your own Anthropic API key, Anthropic bills you instead. See [How AI Credits Work](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/ai-credits-guidelines/).

### [How many prompts can I use per month?](#7-how-many-prompts-can-i-use-per-month-)

There’s no monthly limit. Each prompt uses AI Credits, and when you run out, AI responses pause until you add more. Your local sites keep running normally.

### [Where can I give feedback about WordPress Studio Code responses?](#8-where-can-i-give-feedback-about-the-studio-assistant-s-responses-)

You can [write into support](https://developer.wordpress.com/contact/) to share specific feedback about WordPress Studio Code responses. 

## [WordPress Studio Sync FAQs](#sync)

Here are some answers to common questions about the WordPress Studio Sync feature. Please review [the WordPress Studio Sync doc](https://developer.wordpress.com/docs/developer-tools/studio/sync/) for step-by step instructions and helpful tips for using this feature.

### [Why don’t my local users appear on the WordPress.com site after publishing?](#local-users)

When publishing, WordPress Studio exports all your content and your entire database except for the `wp_users` and `wp_usermeta` tables. This ensures that the Jetpack-powered features on your WordPress.com website (like single sign-on or image optimization) continue working after you publish.