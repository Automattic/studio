# WordPress Studio: Frequently asked questions

This page answers common questions about the WordPress Studio app, WordPress Studio Code, and publishing and pulling.

Jump to [WordPress Studio Code FAQs](https://wordpress.studio/docs/frequently-asked-questions/#wordpress-studio-code-faqs) or [WordPress Studio Sync FAQs](https://wordpress.studio/docs/frequently-asked-questions/#wordpress-studio-sync-faqs). Each answer links to the page with the full steps.

**Applies to:** the WordPress Studio app on macOS, Windows, and Linux. Answers that need a WordPress.com account or the CLI say so.

WordPress Studio is an [open source project](https://github.com/Automattic/studio). If your question isn’t here, [reach out to our Happiness Engineers](https://developer.wordpress.com/contact/), or [open an issue in the repository](https://github.com/Automattic/studio/issues) to report a bug or request a feature.

## General FAQs

### How can I publish my WordPress Studio site so that it’s publicly available?

You need a hosting plan. A [preview](https://wordpress.studio/docs/preview-sites/) is only for sharing work and gathering early feedback. It expires if it goes without an update for a while, and the preview’s details in the **Publish** panel show when. See [Preview expiration](https://wordpress.studio/docs/preview-sites/#preview-expiration).

- **On WordPress.com or Pressable:** [publish your site](https://wordpress.studio/docs/sync/) from the **Publish** panel. You can also [make a preview your live site](https://wordpress.studio/docs/preview-sites/#make-a-preview-your-live-site) by buying a plan for it on WordPress.com.
- **On another WordPress host:** [export your site](https://wordpress.studio/docs/import-export/), then import the export on the destination site, for example with the [Manually Restore Your Site from a Jetpack Backup File on WordPress.com](https://developer.wordpress.com/docs/guides/manually-restore-backup/) guide.

### How can I export a theme I created in WordPress Studio?

Themes created in WordPress Studio are the same as themes on any WordPress site, so you export them from the WordPress Site Editor, where you change your site’s design.

1.  In WordPress Studio, select the local site.
2.  If the site is stopped, start it.
3.  Click **New tab** (**+**) above the site preview.
4.  Choose **Admin**.
5.  In WordPress admin, go to **Appearance → Editor**.
6.  When the WordPress Site Editor loads, click anywhere on the site preview to expand the editor.
7.  Click the **Options** menu (**⋮**) at the top right.
8.  Click **Export**.

Your browser downloads a `.zip` file of your theme. You can then [upload the theme](https://wordpress.com/support/themes/uploading-setting-up-custom-themes/#upload-a-theme-file) to any live or staging WordPress site.

### How can I manage the WordPress Studio site’s SQLite database?

Use WordPress Studio’s built-in phpMyAdmin, which is adapted to work safely with SQLite. In the [site menu](https://wordpress.studio/docs/sites/#site-menu), choose **Open in → phpMyAdmin** to open it in your browser, or **Tools → Database** to open it in the site preview. There you can browse tables, run queries, and edit data.

WordPress Studio uses SQLite instead of a MySQL server. Each site’s database is a single file, `wp-content/database/.ht.sqlite`. Don’t edit that file with other tools, such as a terminal client or a SQLite app. Doing so can corrupt the file, break the schema WordPress expects, or leave you with a database that won’t move to MySQL later.

### How can I use WordPress Studio with the MySQL server of my choice?

Add a site whose `wp-config.php` already points to your MySQL server, or switch an existing WordPress Studio site from SQLite to MySQL. You can use any MySQL server, for example one from Homebrew or Docker.

If the site files include a `wp-config.php` file, WordPress Studio skips the SQLite setup and uses the database that file configures. See [Add a new site using an existing WordPress directory](https://wordpress.studio/docs/sites/#add-a-new-site-using-an-existing-wordpress-directory).

To switch an existing WordPress Studio site from SQLite to MySQL:

1.  Stop the site, so nothing changes after you export the database.
2.  Export the site’s database: in the site menu, choose **Export → Export database** to save a `.sql` file. Export works while the site is stopped. See [Export a site](https://wordpress.studio/docs/import-export/#export-a-site).
3.  Start your MySQL server, create a database, and import the `.sql` file into it with a MySQL tool of your choice.
4.  Open the site’s directory.
5.  In `wp-content`, delete the `db.php` file, and move the `database` directory out of the site’s directory as a backup. Don’t delete it until the site works with MySQL.
6.  In `wp-content/mu-plugins`, delete the `sqlite-database-integration` directory.
7.  In `wp-config.php`, set `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_HOST` to your MySQL database’s details. If a constant is already defined, for example `define( 'DB_NAME', 'wordpress' );`, which WordPress Studio adds for SQLite, change its value. Add only the ones that are missing. A second `define()` for the same constant has no effect.
8.  Start the site in WordPress Studio.
9.  Open the site.

WordPress Studio sets up SQLite again if `db.php`, `database/.ht.sqlite`, or the `sqlite-database-integration` directory is still in the site, so remove all three.

WordPress Studio’s phpMyAdmin supports SQLite only, so **Tools → Database** and **Open in → phpMyAdmin** are unavailable for a site that uses your own MySQL server. Use a separate database client, such as the one that comes with your MySQL server.

### How do I select the PHP and WordPress versions for my site?

Choose them when you create the site, under **Advanced** on the form where you name it. To change them later:

1.  Choose **Settings** from the site menu.
2.  Change the **WordPress version** on the **Settings** page, or the **PHP version** on the **PHP** page.
3.  Click **Save** at the top of the dialog.

See [Edit a site](https://wordpress.studio/docs/sites/#edit-a-site).

### Why isn’t the Open in menu showing my preferred app?

<span id="why-isnt-the-open-in-button-available-for-my-preferred-app"></span>The **Open in** menu only lists apps that WordPress Studio supports and finds on your computer. The [Open in menu](https://wordpress.studio/docs/sites/#open-in-menu) section lists the supported code editors and terminal apps.

- On macOS, the app must be in your Applications folder (`/Applications` or `~/Applications`).
- On Windows, WordPress Studio looks in each app’s usual install folder.
- On Linux, the app must be on your `PATH`.

If you haven’t chosen a **Default code editor** in **Settings → General**, the menu shows the first supported editor it finds, or no editor if none is installed. Without a **Default terminal app**, it uses Terminal on macOS, Command Prompt on Windows, and your system terminal, such as GNOME Terminal or Konsole, on Linux.

### How can I make WordPress Studio faster on Windows?

Add an exclusion for WordPress Studio to the Real-Time Protection Service of Windows Defender. When that service is on, it can slow down creating and starting sites, especially when WordPress runs its PHP files.

WordPress Studio offers to “speed up site creation” the first time you open it on Windows, which adds the exclusion. To add it later, choose **Help → How can I make WordPress Studio faster?** This menu item is only available on Windows.

### Why does WordPress Studio say it’s missing some of its files?

Antivirus software sometimes removes a file that WordPress Studio needs to run your sites, most often on Windows. WordPress Studio then shows “WordPress Studio is missing some of its files”, once each time you open it, and can’t run your sites until you reinstall it.

1.  Click **Download WordPress Studio** to open the download page.
2.  Download and install WordPress Studio again.
3.  If it happens again, allow WordPress Studio in your antivirus settings.

### Where does WordPress Studio keep its settings?

In `~/.studio/config.json`, in your home folder. The desktop app, the WordPress Studio CLI, `studio ui`, and `studio mcp` share this one file, which holds your sites, settings, and logins. Don’t edit it by hand.

Before 2.4.0, WordPress Studio kept them in `shared.json`, `cli.json`, and `app.json`. The first time a newer version runs, it moves them to `config.json` and keeps a copy of the old files in `~/.studio/legacy-config/`. After that, an older version of the app or the CLI on the same computer can’t read your settings until you update it.

### How can I regenerate my thumbnails?

Run this [WordPress Studio CLI](https://wordpress.studio/docs/cli/#installation) command from the site’s directory:

```bash
studio wp media regenerate --yes --only-missing
```

This regenerates thumbnails that are missing, for example after you import a site.

### How can I access WordPress Studio logs?

Choose **Help → Open Application Logs** to open the current log file. When publishing, pulling, importing, or exporting fails, WordPress Studio also offers to open its logs, and may ask you to [contact support](https://developer.wordpress.com/contact/).

| Platform | Logs folder |
| --- | --- |
| macOS | `~/Library/Logs/Studio` |
| Windows | `%APPDATA%\Studio\logs` |
| Linux | `~/.config/Studio/logs` |

### Where do emails sent by my site go?

WordPress Studio saves them instead of sending them. To read them, choose **Tools → Email log** from the site menu. See [Site email](https://wordpress.studio/docs/sites/#site-email).

### Is it possible to change the port or URL of my WordPress Studio site?

You can’t change the port of a `localhost` address, but you can [use a custom domain instead](https://wordpress.studio/docs/sites/#using-a-custom-domain-and-ssl). WordPress Studio gives each site a unique port, starting from 8881. For example, your first site uses `http://localhost:8881`, and your second uses `http://localhost:8882`.

### How can I use a tunneling tool (ngrok) with WordPress Studio?

Run [ngrok](https://ngrok.com/) to make your local site reachable from the internet, then set the tunnel address as the site’s URL in `wp-config.php`. This helps with plugins that need incoming connections, such as Jetpack, which runs in offline mode on a local site. With a tunnel, Jetpack can connect to WordPress.com.

To start the tunnel:

1.  Start your WordPress Studio site.
2.  Note the site’s address. A `localhost` site’s port, such as `8883`, is shown in the site preview’s address bar. A custom domain, such as `my-wordpress-website.wp.local`, is under **Local domain** on the **Settings** page of the site’s settings.
3.  In a terminal, [set up ngrok](https://dashboard.ngrok.com/get-started/setup) if you haven’t already.
4.  Start the tunnel with the command for your site’s address.

For a `localhost` site, use its port:

```bash
ngrok http 8883
```

For a site with a custom domain:

```bash
ngrok http --host-header=my-wordpress-website.wp.local http://my-wordpress-website.wp.local
```

To point the site at the tunnel:

1.  Copy the tunnel URL ngrok shows. It looks like `https://6xb2-12-13-14-15.ngrok-free.app`.
2.  Add these lines to the site’s `wp-config.php`, with your tunnel URL:

    ```php
    define( 'WP_SITEURL', 'https://6xb2-12-13-14-15.ngrok-free.app' );
    define( 'WP_HOME', 'https://6xb2-12-13-14-15.ngrok-free.app' );
    ```

3.  Refresh the site in your browser.

The site now opens at the tunnel URL. If it doesn’t redirect, clear your browser cache, or open the tunnel URL directly.

The local URL shown in WordPress Studio doesn’t change to the tunnel URL. The ngrok URL changes each time you restart the tunnel, so update `wp-config.php` each time.

To go back to the local address:

1.  Stop the tunnel in the terminal.
2.  Stop the site in WordPress Studio.
3.  Remove the two lines from `wp-config.php`.
4.  Start the site.

The site uses its `localhost` address or the custom domain under **Local domain** again.

### How can I export my site for use on the WordPress Playground website?

Create a ZIP file from the contents of your site folder, then import it in your browser with the [Site Explorer](https://wordpress.github.io/wordpress-playground/web-instance#1-site-explorer) on [playground.wordpress.net](https://playground.wordpress.net/).

Top-level files such as `wp-config.php` must be at the root of the archive. To do that, select all the files and folders inside the site folder when you create the ZIP file, not the site folder itself.

## WordPress Studio Code FAQs

For the full steps, see [WordPress Studio Code](https://wordpress.studio/docs/studio-code/).

### What languages does WordPress Studio Code support?

You can talk with WordPress Studio Code in any language you prefer.

### Can I use WordPress Studio Code without a WordPress.com account?

Yes, with another AI provider, such as your own Anthropic API key. Connect **Anthropic**, **OpenAI**, **Google Gemini**, **GitHub Copilot**, or **Meta** in **Settings → Providers** in the desktop app, or use `/connect` in the terminal. That provider or plan bills you. See [Providers in WordPress Studio](https://wordpress.studio/docs/providers/).

Some features still need a WordPress.com login. These are WordPress.com AI credits, [image generation](https://wordpress.studio/docs/studio-code/image-generation/) with WordPress.com, previews, and publishing to WordPress.com. See [Connect to WordPress.com](https://wordpress.studio/docs/#connect-to-wordpresscom).

### Is there any cost to use WordPress Studio Code?

With WordPress.com as your AI provider, you start with a one-time free allowance of AI credits for Fast. Your first purchase unlocks Balanced and Strong, and any remaining free allowance works with all three tiers. If you connect another provider, such as your own Anthropic API key, that provider bills you. See [How AI Credits Work](https://wordpress.studio/docs/studio-code/ai-credits-guidelines/).

### How many prompts can I use per month?

WordPress.com AI credits have no monthly prompt limit. Prompts through WordPress.com pause when your credit balance runs out and resume when you add more. Your local sites keep running.

### Where can I give feedback about WordPress Studio Code responses?

Type `/feedback` in the chat to [send feedback from a chat](https://wordpress.studio/docs/studio-code/#send-feedback-from-a-chat), or [write to support](https://developer.wordpress.com/contact/).

## WordPress Studio Sync FAQs

For the full steps, see [Publish and pull your site](https://wordpress.studio/docs/sync/).

### Why don’t my local users appear on the WordPress.com site after publishing?

Publishing sends all your content and your whole database except the `wp_users` and `wp_usermeta` tables. This keeps the Jetpack features on your WordPress.com site, such as single sign-on and image optimization, working after you publish.
