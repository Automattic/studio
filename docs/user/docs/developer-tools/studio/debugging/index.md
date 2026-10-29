# Debugging in Studio

WordPress Studio includes several built-in tools to help you find and fix issues in your local WordPress sites — without needing to install extra software or leave the app.

## [Debug log](#0-debug-log)

Sometimes you just need to see what WordPress is logging. Studio makes that easy with a dedicated debug log toggle that configures `WP_DEBUG` and `WP_DEBUG_LOG` for your site automatically.

### [Enabling the debug log](#1-enabling-the-debug-log)

1.  Open the site’s settings: choose **Settings** from the site menu (click the site icon at the top of the chat, or right-click the site in the sidebar).
2.  Select the **Debug** page.
3.  Turn on **Debug log**.
4.  Click **Save** at the top of the dialog.

<!-- TODO screenshot: replace with `site-settings-debug.webp` from `npm run screenshots` (Studio 2.0): the Site scope Debug page. -->
[![The Debug page of a site's settings in Studio.](https://developer.wordpress.com/wp-content/uploads/2026/01/site-debugging.png)](https://developer.wordpress.com/wp-content/uploads/2026/01/site-debugging.png)

When the debug log is enabled, your site will capture PHP errors, notices, and warnings to `wp-content/debug.log`. Once the file exists, an **Open log file** link appears on the **Debug** page, so you can jump directly to the file without hunting for its path.

You can also write your own messages to the log using PHP’s `error_log()` function:

error\_log( 'My value: ' . print\_r( $my\_variable, true ) );

### [Show errors in browser](#2-show-errors-in-browser)

The **Debug** page also includes a **Show errors in browser** toggle, which sets `WP_DEBUG_DISPLAY`. When enabled, PHP errors and warnings are printed inline in the page output rather than captured silently in the log file — useful when you want immediate feedback during active development.

Keep in mind:

-   **Show errors in browser** works best alongside the debug log, not as a replacement for it.
-   Turn it off on any site you share with clients — it can expose internal path information or other implementation details in the page output.

### [Script debug and environment type](#script-debug-and-environment-type)

The **Debug** page also includes:

-   **Script debugging**, which sets `SCRIPT_DEBUG`. WordPress then loads the development versions of core CSS and JavaScript instead of the minified files, which is useful for reading React errors in the block editor.
-   **Environment**, which sets the value returned by `wp_get_environment_type()`: **Local** (the default), **Development**, **Staging**, or **Production**. Plugins and themes use it to vary their behavior between environments.

### [Using AI agents to interpret debug logs](#4-using-ai-agents-to-interpret-debug-logs)

Once your debug log is active, you can point an AI agent directly at it. Tell your agent — whether you’re using Claude Code, Cursor, or another tool — that error logs are available at `wp-content/debug.log`. From there, it can read the output, identify what’s going wrong, and suggest fixes without breaking your flow.

## [Database access with phpMyAdmin](#5-database-access-with-phpmyadmin)

Inspecting or editing your local database used to mean a separate tool and a separate setup. Studio includes phpMyAdmin access directly in the app — so you can query tables, check data, and debug schema issues without leaving the app or configuring anything.

To open phpMyAdmin for a running site, select the site and use either of these:

-   Click the site preview’s address bar and choose **Database**, or choose **Go to → Database** from the site menu. phpMyAdmin opens inside the preview.
-   Choose **Open in → phpMyAdmin** from the site menu to open it in your browser.

<!-- TODO screenshot: replace with `preview-destinations.webp` from `npm run screenshots` (Studio 2.0): the address bar shortcuts. -->
[![The address menu in Studio's site preview, open to show the Front end, WP Admin, and Database options.](https://developer.wordpress.com/wp-content/uploads/2026/04/preview-destinations.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2026/04/preview-destinations.png)

## [Step-through debugging with Xdebug](#6-step-through-debugging-with-xdebug)

For deeper investigation, Studio includes [Xdebug](https://xdebug.org/) support. Instead of scattering debug output through your code, you can set breakpoints, step through execution line by line, and inspect variables in real time — all from your editor.

Xdebug is available for all Studio sites and requires no system-level installation. Studio listens for debug connections on port `9003`.

For full setup instructions, including how to connect VS Code and PhpStorm, see [Xdebug in Studio](https://developer.wordpress.com/docs/developer-tools/studio/xdebug/).