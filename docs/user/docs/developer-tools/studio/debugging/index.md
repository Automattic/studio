# Debugging in Studio

WordPress Studio includes several built-in tools to help you find and fix issues in your local WordPress sites — without needing to install extra software or leave the app.

## [Debug log](#0-debug-log)

Sometimes you just need to see what WordPress is logging. Studio makes that easy with a dedicated debug log toggle that configures `WP_DEBUG` and `WP_DEBUG_LOG` for your site automatically.

### [Enabling the debug log](#1-enabling-the-debug-log)

1.  Select the site you want to debug, and click the **Site overview** button next to its name in the sidebar.
2.  Open the **Debugging** tab.
3.  Check **Enable debug log**.
4.  Click **Save settings**.

[![The Debugging tab of the site overview in Studio.](https://developer.wordpress.com/wp-content/uploads/2026/01/site-debugging.png)](https://developer.wordpress.com/wp-content/uploads/2026/01/site-debugging.png)

When the debug log is enabled, your site will capture PHP errors, notices, and warnings to `wp-content/debug.log`. Once the file exists, an **Open log file** link appears on the **Debugging** tab, so you can jump directly to the file without hunting for its path.

You can also write your own messages to the log using PHP’s `error_log()` function:

error\_log( 'My value: ' . print\_r( $my\_variable, true ) );

### [Show errors in browser](#2-show-errors-in-browser)

The **Debugging** tab also includes a **Show errors in browser** toggle, which sets `WP_DEBUG_DISPLAY`. When enabled, PHP errors and warnings are printed inline in the page output rather than captured silently in the log file — useful when you want immediate feedback during active development.

Keep in mind:

-   **Show errors in browser** works best alongside the debug log, not as a replacement for it.
-   Turn it off on any site you share with clients — it can expose internal path information or other implementation details in the page output.

### [Script debug and environment type](#script-debug-and-environment-type)

The **Debugging** tab also includes:

-   **Enable script debug**, which sets `SCRIPT_DEBUG`. WordPress then loads the development versions of core CSS and JavaScript instead of the minified files, which is useful for reading React errors in the block editor.
-   **Environment type**, which sets the value returned by `wp_get_environment_type()`: **Local** (the default), **Development**, **Staging**, or **Production**. Plugins and themes use it to vary their behavior between environments.

### [Using AI agents to interpret debug logs](#3-using-ai-agents-to-interpret-debug-logs)

Once your debug log is active, you can point an AI agent directly at it. Tell your agent — whether you’re using Claude Code, Cursor, or another tool — that error logs are available at `wp-content/debug.log`. From there, it can read the output, identify what’s going wrong, and suggest fixes without breaking your flow.

## [Database access with phpMyAdmin](#4-database-access-with-phpmyadmin)

Inspecting or editing your local database used to mean a separate tool and a separate setup. Studio includes phpMyAdmin access directly in the app — so you can query tables, check data, and debug schema issues without leaving the app or configuring anything.

To open phpMyAdmin for a running site, select the site and use either of these:

-   In the site preview, open the address menu and choose **Database**. phpMyAdmin opens inside the preview.
-   On the site overview’s **Overview** tab, click **phpMyAdmin** under **Open in…** to open it in your browser.

[![](https://developer.wordpress.com/wp-content/uploads/2026/04/preview-destinations.png?w=1024)](https://developer.wordpress.com/wp-content/uploads/2026/04/preview-destinations.png)

## [Step-through debugging with Xdebug](#5-step-through-debugging-with-xdebug)

For deeper investigation, Studio includes [Xdebug](https://xdebug.org/) support. Instead of scattering debug output through your code, you can set breakpoints, step through execution line by line, and inspect variables in real time — all from your editor.

Xdebug is available for all Studio sites and requires no system-level installation. Studio listens for debug connections on port `9003`.

For full setup instructions, including how to connect VS Code and PhpStorm, see [Xdebug in Studio](https://developer.wordpress.com/docs/developer-tools/studio/xdebug/).