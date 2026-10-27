# Xdebug in WordPress Studio

WordPress Studio includes Xdebug support for local sites. [Xdebug](https://xdebug.org/) is a debugging extension for PHP that enables you to set breakpoints, inspect variables, and step through your code.

## [Enabling Xdebug](#0-enabling-xdebug)

1.  Open the site’s settings: choose **Settings** from the site menu (click the site icon at the top of the chat, or right-click the site in the sidebar).
2.  Select the **Debug** page.
3.  Turn on **Xdebug**.
4.  Click **Save** at the top of the dialog.

[![The Debug page of a site's settings in Studio, with Xdebug turned on.](https://developer.wordpress.com/wp-content/uploads/2026/01/site-debugging.png)](https://developer.wordpress.com/wp-content/uploads/2026/01/site-debugging.png)

The site will restart automatically with Xdebug enabled. While Xdebug is enabled, the site shows an Xdebug icon in the sidebar.

## [Important limitations](#1-important-limitations)

-   **Only one site at a time**: Xdebug can only be enabled for a single site at once. If another site already has it enabled, the **Debug** page shows “Xdebug is enabled on another site:” followed by that site’s name. To enable it for a different site, you must first disable it on the current site.
-   **Performance impact**: Xdebug may slow down site performance. Disable it when not actively debugging.

## [Using Xdebug with your IDE](#2-using-xdebug-with-your-ide)

Once Xdebug is enabled for a site, you can connect your IDE (code editor) to debug WordPress plugins, themes, and core code.

Studio runs sites on native PHP, which uses the real file paths on disk, so you don’t need path mapping in your editor. If you previously set up a `/wordpress` path mapping for the Sandbox runtime, which Studio 1.24.0 removed, you can delete it.

### [Visual Studio Code setup](#3-visual-studio-code-setup)

1.  Install the [PHP Debug extension](https://marketplace.visualstudio.com/items?itemName=xdebug.php-debug).
2.  Create a `.vscode/launch.json` file in your project:

{
  "version": "0.2.0",
  "configurations": \[
    {
      "name": "Listen for Xdebug",
      "type": "php",
      "request": "launch",
      "port": 9003
    }
  \]
}

3.  Set breakpoints in your code.
4.  Start the debugging session in Visual Studio Code (**Run** → **Start Debugging**).
5.  Navigate to your site in the browser to trigger the breakpoints.

### [PhpStorm Setup](#4-phpstorm-setup)

1.  Go to **Settings** → **PHP** → **Debug**.
2.  Verify that the Xdebug port is set to **9003**.
3.  To stop breaking at the first line:
    -   Disable “Force break at first line when no path mapping specified”
    -   Disable “Force break at first line when a script is outside the project”
4.  Enable “**Start listening for PHP Debug Connections**” from the toolbar.
5.  Set breakpoints in your code.
6.  Navigate to your site in the browser to trigger the breakpoints.

## [Learn more](#5-learn-more)

For more details about Xdebug, see the [Xdebug documentation](https://xdebug.org/docs/).