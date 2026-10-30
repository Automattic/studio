# PHP runtimes

The backbone of every WordPress site is the PHP code that runs on the server. PHP is an interpreted language, meaning every WordPress site ships with actual source code rather than a compiled binary. To run this source code, a “PHP runtime” is needed.

Studio runs every site on native PHP binaries. Native PHP runs the code with few abstractions around the system, so sites are fast and behave like they would on a typical PHP server. Studio supports PHP 8.2, 8.3, 8.4, and 8.5.

## [What happened to the Sandbox runtime?](#0-what-happened-to-the-sandbox-runtime-)

Earlier versions of Studio offered a second runtime, **Sandbox**, which ran sites on [WordPress Playground](https://wordpress.org/playground/) WebAssembly binaries. Studio 1.24.0 removed the Sandbox runtime and removed the PHP runtime setting from the create site form and site settings.

Sites that used the Sandbox runtime move to native PHP automatically the first time you open Studio or run a Studio CLI command after updating. You don’t need to do anything. If one of these sites was set to a PHP version that Studio no longer supports, such as PHP 7.4, Studio moves it to the closest supported version.

A few things to be aware of after the move:

-   Sites that are already running when you update aren’t restarted. They switch to native PHP the next time they start.
-   If you use Xdebug, you no longer need the `/wordpress` path mapping. Native PHP uses the real paths on disk, so remove any Sandbox path mappings from your editor. See [Xdebug in WordPress Studio](https://developer.wordpress.com/docs/developer-tools/studio/xdebug/).
-   If you created a site with the experimental `pull-reprint` command while it was on the Sandbox runtime, you may need to pull it again.
-   Native PHP installs a site’s language pack if it’s missing, and WP-CLI can run as the root user, for example inside a Docker container.
-   On Windows, `wp-cli` steps in Blueprints don’t run yet on native PHP. This is a known issue.

The Studio CLI no longer accepts the `--runtime` option for `studio create` or `studio config set`.

## [File access](#1-file-access)

The **File access** setting controls which files PHP can access on your computer. It has two options:

-   **Site directory** (default): PHP can only access the site directory, the system temporary directory, and a few Studio-specific directories, such as the one phpMyAdmin runs from.
-   **All files:** PHP can access any file on your system.

With **Site directory**, Studio applies PHP’s `open_basedir` directive and disables a small set of risky PHP functions, such as creating symlinks or sending signals to other processes. This is not a strict sandbox, but it provides some degree of protection around misbehaving or low-effort malicious code, such as path traversal bugs that try to read or delete files outside the site.

Symlinked files and directories inside the site, such as a plugin or theme you’ve symlinked from another folder, are allowed automatically. If you add a new symlink while the site is running, Studio restarts the site to allow it.

Typically, access to the site directory and related directories is enough for most sites. If you want PHP to have access to all files on your system, open the site’s settings (choose **Settings** from the site menu) and select the **PHP** page. Change the **File access** setting to **All files**, then click **Save** at the top of the dialog. You can also choose the file access when creating a site, under **Advanced settings**.

<!-- TODO screenshot: replace with `site-settings-php.webp` from `npm run screenshots` (Studio 2.0): the Site scope PHP page: PHP version and File access. -->
[![The PHP page of a site's settings in Studio: PHP version and File access.](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings-php.png)](https://developer.wordpress.com/wp-content/uploads/2025/01/site-settings-php.png)

To change the setting with the [Studio CLI](https://developer.wordpress.com/docs/developer-tools/studio/cli/), run the following from the site’s directory:

```
studio config set --file-access all-files
```

Use `--file-access site-directory` to restore the default. You can also pass `--file-access` to `studio create`.

### [Child processes](#2-child-processes)

PHP can run external commands and spawn any child process, just like a typical local PHP installation. This keeps plugins and tools that shell out working, such as image processing, backups, and Git.

Child processes run as your user account and are not subject to the `open_basedir` restrictions of the main process. Because of this, the **Site directory** setting does not protect against deliberately malicious plugins or themes. Only install code you trust.
