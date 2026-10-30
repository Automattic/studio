# WordPress Studio

[WordPress Studio](https://developer.wordpress.com/studio/?ref=docs) is the agentic local development tool for WordPress. Spin up [local sites](https://developer.wordpress.com/docs/developer-tools/studio/sites/) in seconds and generate anything from plugins, themes, images and content to full site builds using [Studio Code](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/), our custom WordPress AI agent. 

Your sites and their Studio Code chats share one sidebar, with the live site preview right beside the chat. The preview lets you browse the front end, WP Admin, and the site database without leaving the app. Batch smaller updates quickly and easily and dispatch them to the Studio Code agent with one click using the Annotate tool. 

Studio sites support [SSL](https://developer.wordpress.com/docs/developer-tools/studio/ssl/) and custom local domains to match your production environment. Use [Blueprints](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/) to define exactly which plugins, themes, and content each site starts with, so you can reproduce the same setup every time.

Manage your site from the terminal with [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/) or use the [built-in debugging tools](https://developer.wordpress.com/docs/developer-tools/studio/debugging/), including a debug log, phpMyAdmin, and [Xdebug](https://developer.wordpress.com/docs/developer-tools/studio/xdebug/), to help you diagnose issues.

[Publish to WordPress.com and Pressable](https://developer.wordpress.com/docs/developer-tools/studio/sync/) and pull changes back: bring an existing online site down to work on it locally, or publish any local site to production or staging when it’s ready. You can also [import from a backup](https://developer.wordpress.com/docs/developer-tools/studio/import-export/) or export your local work as a ready-to-deploy archive. Use **Share** to send anyone a temporary [preview site](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/) with a public URL.

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

1.  The **Welcome to WordPress Studio** dialog explains what a free WordPress.com account adds: building with the agent, sharing previews, and publishing. Click **Continue with WordPress.com** to log in or create a free account, or click **Not now** to go straight to creating your first local site. You can also choose whether to **Share anonymous usage statistics** here.
2.  The **Add site** dialog opens. You can create a new site, connect an existing WordPress.com or Pressable site, import a backup, or start from a Blueprint. See [Studio Sites](https://developer.wordpress.com/docs/developer-tools/studio/sites/) for each option.
3.  Once your first site is ready, a short guide introduces the sidebar, building with Studio Code, and the live site preview. Click **Next** to step through it and **Let’s go** to finish, or **Skip** to close it.

If you’re upgrading from an earlier version of Studio, your existing sites carry over, and the same guide opens with **Welcome to WordPress Studio 2.0**. If you’ve already seen the guide, a short **What’s New** guide introduces what changed instead. To see either one again, choose **Help → Getting Started** or **Help → What’s New** in the menu bar.

<!-- TODO screenshot: replace with `welcome.webp` from `npm run screenshots` (Studio 2.0): the Welcome to WordPress Studio dialog. -->
[![A screenshot of the WordPress Studio welcome screen](https://developer.wordpress.com/wp-content/uploads/2024/04/welcome.png)](https://developer.wordpress.com/wp-content/uploads/2024/04/welcome.png)

### [Find your way around](#find-your-way-around)

The Studio window has three areas:

-   **Sidebar** (left): your sites, each with its Studio Code chats. Pinned sites and chats appear in a **Pinned** section at the top, and your latest chats appear under **Recent**. Click the **+** next to **Sites** to add a site. At the bottom of the sidebar you’ll find **Log in** (or your account menu once you’re logged in), **Settings**, and your notification history.
-   **Chat** (middle): Studio Code for the selected site.
-   **Site preview** (right): the selected site.

<!-- TODO screenshot: add `main-window-signed-in.webp` from `npm run screenshots` (Studio 2.0, signed-in suite) here: the full Studio window, with the sidebar, the chat and the site preview, and the header buttons. -->

The header above the chat and preview starts with the **Site menu** button (globe), which opens the site’s actions menu, and **Close chat** (**Open chat** when the chat is closed). Then come the preview’s **Back**, **Forward**, and **Reload preview** buttons, **Responsive mode**, and the address bar, followed by **Annotate**, **Publish**, and **Share**.

When a new version of Studio is ready to install, an **Update available** button appears at the bottom of the sidebar, next to **Settings**. Click it to update Studio. If the update fails, Studio shows “Couldn’t update Studio” with the reason.

Press ⌘K (Ctrl+K on Windows and Linux) to open the command palette, where you can jump to any site or chat, run a site action, or change a setting. Press ⌘, (Ctrl+, on Windows and Linux) to open **Settings**, and ⌘B (Ctrl+B) to show or hide the sidebar. The full list of shortcuts is in **Settings → Keyboard**.

<!-- TODO screenshot: add `command-palette.webp` from `npm run screenshots` (Studio 2.0) here: the command palette. -->
<!-- TODO screenshot: add `settings-keyboard.webp` from `npm run screenshots` (Studio 2.0) here: Settings → Keyboard. -->

### [Connect to WordPress.com](#connect-wordpress-com)

By connecting your WordPress.com account to WordPress Studio, you unlock features like preview sites, publishing to WordPress.com and Pressable, and access to Studio Code with WordPress.com AI credits. It also ensures you’re ready for upcoming improvements that rely on a WordPress.com connection.

If you don’t already have a WordPress.com account, you can [create one for free](https://wordpress.com/start/?ref=developer-docs).

To connect Studio to WordPress.com:

1.  Click **Log in** at the bottom of the sidebar. You can also log in from the welcome dialog when you first open Studio, from **Connect** under **Do more with WordPress.com** in **Settings → General**, or from the prompt that appears when you click **Publish** or **Share** while logged out.
2.  A new browser window will open. Log into WordPress.com.
3.  On the authorization screen, click **Approve** to connect Studio to your account.
4.  Once approved, a popup will appear prompting you to open the Studio app. Click on the **“Open Studio”** button to finalize the process.

<!-- TODO screenshot: replace with `main-window-signed-out.webp` from `npm run screenshots` (Studio 2.0): the main window, logged out, with Log in at the bottom of the sidebar. -->
[![A screenshot of a new site and the Log in with WordPress.com button](https://developer.wordpress.com/wp-content/uploads/2024/04/main-window-signed-out.png)](https://developer.wordpress.com/wp-content/uploads/2024/04/main-window-signed-out.png)

Once you’ve logged into WordPress.com, your account menu replaces the **Log in** button at the bottom of the sidebar, Studio Code can use your WordPress.com AI credits, and the **Publish** and **Share** buttons above the site preview let you publish your site and share preview links. If they still ask you to log in, you might need to *restart* the desktop application.

<!-- TODO screenshot: add `account-menu.webp` from `npm run screenshots` (Studio 2.0, signed-in suite) here: the account menu, with the email masked; `main-window-signed-in.webp` and `settings-account.webp` (Settings → General, account row) are alternatives. -->

## [Next steps and feedback](#6-next-steps-and-feedback)

We hope Studio effortlessly fits into your local development workflow. Be sure to check out our other docs about specific Studio features:

-   [Studio Sites](https://developer.wordpress.com/docs/developer-tools/studio/sites/)
-   [Preview Sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/)
-   [Studio Sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/)
-   [Import & Export](https://developer.wordpress.com/docs/developer-tools/studio/import-export/)
-   [Studio Code](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/)
-   [SSL in Studio](https://developer.wordpress.com/docs/developer-tools/studio/ssl-in-studio/)
-   [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/)
-   [Studio Frequently Asked Questions](https://developer.wordpress.com/docs/developer-tools/studio/frequently-asked-questions/)

WordPress Studio is an [open source project](https://github.com/Automattic/studio) that welcomes all contributions. If you spot a bug or the feature you need is missing, we have some options:

-   [Reach out to our Happiness Engineers](https://developer.wordpress.com/contact/) for specific questions about using Studio.
-   [Open an issue in the repository](https://github.com/Automattic/studio/issues) to report bugs, suggest ideas, or request new features.