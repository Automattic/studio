# WordPress Studio

[WordPress Studio](https://developer.wordpress.com/studio/?ref=docs) is the agentic local development tool for WordPress. Spin up [local sites](https://developer.wordpress.com/docs/developer-tools/studio/sites/) in seconds and generate anything from plugins, themes, images and content to full site builds using [Studio Code](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/), our custom WordPress AI agent. 

The built-in browser allows you to preview the site without leaving the app, access the admin dashboard and site database, even test desktop and mobile responsiveness. Batch smaller updates quickly and easily and dispatch them to the Studio Code agent with one click using the new Annotate tool. 

Studio sites support [SSL](https://developer.wordpress.com/docs/developer-tools/studio/ssl/) and custom local domains to match your production environment. Use [Blueprints](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/) to define exactly which plugins, themes, and content each site starts with, so you can reproduce the same setup every time.

Manage your site from the terminal with [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/) or use the [built-in debugging tools](https://developer.wordpress.com/docs/developer-tools/studio/debugging/), including a debug log, phpMyAdmin, and [Xdebug](https://developer.wordpress.com/docs/developer-tools/studio/xdebug/), to help you diagnose issues.

[Sync with WordPress.com and Pressable](https://developer.wordpress.com/docs/developer-tools/studio/sync/) in both directions: pull an existing online site to work on it locally, or push any local site to production or staging when it’s ready. You can also [import from a backup](https://developer.wordpress.com/docs/developer-tools/studio/import-export/) or export your local work as a ready-to-deploy archive. Share your work in progress by pushing to a temporary [preview site](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/) with a public URL.

## [Quick start](#0-quick-start)

To install Studio, visit the official [WordPress Studio page](https://developer.wordpress.com/studio/?ref=dev-doc) and download the installer for your operating system: macOS, Windows, or Linux. Alternatively, you can install Studio for Windows directly from the [Microsoft Store](https://apps.microsoft.com/detail/9pntbl35pzvs).

### [Requirements](#1-requirements)

-   Mac: macOS 13 (Ventura) or newer
-   Windows: 64-bit Windows
-   Linux: 64-bit Debian based.

### [Install WordPress Studio for macOS](#2-install-wordpress-studio-for-macos)

To install and start using Studio on macOS:

1.  [Download the correct installer](https://developer.wordpress.com/studio/?ref=dev-doc) for your computer’s specs: [Silicon or Intel](https://support.apple.com/en-us/116943).
2.  Open the downloaded file.
3.  Drag the Studio application to your Applications folder.
4.  Double-click the Studio icon to start the Studio app.
5.  Follow the [first-run steps](#first-run) to add your first site.

### [Install WordPress Studio for Windows](#3-install-wordpress-studio-for-windows)

To install and start using Studio on Windows from Microsoft Store:

1.  Access [Studio on the Microsoft Store](https://apps.microsoft.com/detail/9pntbl35pzvs) from your Windows computer.
2.  Click Install.
3.  Once installed, launch Studio from your Start menu.
4.  Follow the [first-run steps](#first-run) to add your first site.

To install and start using Studio on Windows from WordPress.com:

1.  [Download the Windows installer](https://developer.wordpress.com/studio/).
2.  Open the setup `.exe` file.
3.  Wait for Studio to install, it will launch automatically once the installation is complete. 
4.  Follow the [first-run steps](#first-run) to add your first site.

### [First run](#first-run)

The first time you open Studio, it walks you through a short setup:

1.  The **Welcome** screen introduces WordPress Studio. Here you can also choose whether to share anonymous usage statistics, log in to or sign up for, WordPress.com to use the AI and hosting functions, or skip that and go to creating your first local site.
2.  A short tour explains how Studio works. 
3.  On the **Add a site** screen, you can create a new site, connect an existing WordPress.com or Pressable site, import a backup, or start from a Blueprint. See [Studio Sites](https://developer.wordpress.com/docs/developer-tools/studio/sites/) for each option.
4.  Once your first site is ready, a short orientation guide introduces the sidebar, Studio Code, and the site preview. Click **Next** to step through it, or **Skip** to close it.

[![A screenshot of the WordPress Studio welcome screen](https://developer.wordpress.com/wp-content/uploads/2024/04/welcome.png)](https://developer.wordpress.com/wp-content/uploads/2024/04/welcome.png)

### [Connect to WordPress.com](#connect-wordpress-com)

By connecting your WordPress.com account to WordPress Studio, you unlock features like preview sites, syncing with WordPress.com and Pressable, and access to the Studio Code. It also ensures you’re ready for upcoming improvements that rely on a WordPress.com connection.

If you don’t already have a WordPress.com account, you can [create one for free](https://wordpress.com/start/?ref=developer-docs).

To connect Studio to WordPress.com:

1.  Click **Log in with WordPress.com**. You can find it on the **Build with Studio Code** step of the first-run tour, in the Studio Code pane of any site while you’re logged out, and in **App settings → Settings → WordPress.com account**.
2.  A new browser window will open. Log into WordPress.com.
3.  On the authorization screen, click **Approve** to connect Studio to your account.
4.  Once approved, a popup will appear prompting you to open the Studio app. Click on the **“Open Studio”** button to finalize the process.

[![A screenshot of a new site and the Log in with WordPress.com button](https://developer.wordpress.com/wp-content/uploads/2024/04/main-window-signed-out.png)](https://developer.wordpress.com/wp-content/uploads/2024/04/main-window-signed-out.png)

Once you’ve logged into WordPress.com, Studio Code is available in the chat pane, and the site menu at the top of the chat (click the site’s name) shows the **Previews** and **Live sites** sections, so you can share and sync your site. If they still ask you to log in, you might need to *restart* the desktop application.

## [Next steps and feedback](#5-next-steps-and-feedback)

We hope Studio effortlessly fits into your local development workflow. Be sure to check out our other docs about specific Studio features:

-   [Studio Sites](https://developer.wordpress.com/docs/developer-tools/studio/sites/)
-   [Preview Sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/)
-   [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/)
-   [](https://developer.wordpress.com/docs/developer-tools/studio/import-export/)[Import & Export](https://developer.wordpress.com/docs/developer-tools/studio/import-export/)
-   [Studio Code](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/)
-   [SSL in Studio](https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/)
-   [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/)
-   [Studio Frequently Asked Questions](https://developer.wordpress.com/docs/developer-tools/studio/frequently-asked-questions/)

WordPress Studio is an [open source project](https://github.com/Automattic/studio) that welcomes all contributions. If you spot a bug or the feature you need is missing, we have some options:

-   [Reach out to our Happiness Engineers](https://developer.wordpress.com/contact/) for specific questions about using Studio.
-   [Open an issue in the repository](https://github.com/Automattic/studio/issues) to report bugs, suggest ideas, or request new features.