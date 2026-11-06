# WordPress Studio CLI

WordPress Studio CLI comes bundled with WordPress Studio. You can also install it on its own with a standalone installer, or as a npm module [wp-studio](https://www.npmjs.com/package/wp-studio).

If you already have WordPress Studio installed, the easiest way to try the CLI is to enable it in the app’s settings. Otherwise, install it on its own with the standalone installer.

WordPress Studio CLI is a globally available command-line utility that lets you interact with [WordPress Studio](https://developer.wordpress.com/docs/developer-tools/studio/) features from your terminal, regardless of whether WordPress Studio is open or not.

It’s especially useful for:

-   Managing local WordPress Studio sites.
-   Creating and updating preview sites on WordPress.com.
-   Running WP-CLI commands.
-   Integrate with AI coding agents. Every site comes with an AGENTS.md file.
-   Integrating WordPress Studio into scripts and build steps.

## [Installation](#0-installation)

### [WordPress Studio app](#1-studio-app)

1.  Open the **“WordPress Studio**” application.
2.  Click **Settings** at the bottom of the sidebar, or press ⌘, (Ctrl+, on Windows and Linux).
3.  On the **General** page, under **WordPress Studio CLI**, turn on the **WordPress Studio CLI for terminal** option.
4.  On macOS, you’ll be prompted for your account password to allow installation.

The option isn’t available in the Microsoft Store version of WordPress Studio. If you installed the CLI with the standalone installer, the option is turned on and can’t be changed in the app: run `studio uninstall` to remove that CLI.

### [Standalone installer](#2-standalone-installer)

#### macOS / Linux

curl -fsSL https://wordpress.studio/install.sh | bash

#### Windows (PowerShell)

irm https://wordpress.studio/install.ps1 | iex

Open a new terminal so `studio` is on your `PATH`, then verify:

studio --help

#### Uninstall

To remove a CLI installed with the standalone installer, run:

studio uninstall

This stops your running sites and removes the CLI and its `PATH` entry. Your sites and your WordPress Studio config in `~/.studio` stay. Add `--purge` to also delete `~/.studio`. A CLI installed with npm is removed with `npm rm -g wp-studio`, and the CLI bundled with the WordPress Studio app is removed when you uninstall the app.

### [npm](#3-npm)

npm install -g wp-studio

## [Usage](#4-usage)

The WordPress Studio CLI is invoked with the studio command. Commands that manage local sites, such as `studio create` or `studio start`, are top-level commands. Other commands are grouped by area and follow the pattern:

studio <area> <command> \[options\]

You can see a high-level overview at any time with:

studio --help

```text
WordPress Studio CLI

Commands:
  studio auth                  Manage authentication
  studio code                  AI agent for building and managing WordPress sites
  studio create                Create a new site
  studio list                  List sites
  studio start                 Start site
  studio stop                  Stop site(s)
  studio delete [sites..]      Delete site
  studio status                Get status of site
  studio push                  Push your local site to a WordPress.com site
  studio pull                  Pull a WordPress.com site to your local site
  studio import <import-file>  Import a backup file to site
  studio export [export-file]  Export site to a backup file
  studio ui                    Start the local Studio web UI and open it in your browser
  studio uninstall             Uninstall the standalone Studio CLI
  studio preview               Manage preview sites
  studio config                Manage site configuration
  studio wp                    WP-CLI
  studio blueprint             Browse and use blueprints
  studio mcp                   MCP server for AI agents

Options:
  -p, --path     Path to the WordPress files         [string] [default: Current directory]
  -v, --version  Show version number                                             [boolean]
  -h, --help     Show help                                                       [boolean]
```

Most commands are designed to be run from the root directory of a WordPress Studio-managed site. To target a different site directory than your current working directory, use the `--path` option:

studio <area> <command> --path /path/to/site

## [Authentication commands](#5-authentication-commands)

Use the `auth` commands to manage your WordPress.com authentication for WordPress Studio features that require a logged-in user (for example, preview sites).

studio auth login      # Log in to WordPress.com
studio auth logout     # Log out and clear WordPress.com authentication
studio auth status     # Check authentication status

-   `studio auth login` opens a browser-based flow to connect the CLI to your WordPress.com account. You will receive an authentication token to paste into the terminal to complete the login process.
-   `studio auth status` reports whether you are currently authenticated and shows which account is in use.
-   `studio auth logout` disconnects the CLI from your WordPress.com account and clears stored credentials.

If you run a command that requires authentication (such as `studio preview create`, `studio push`, or `studio pull`) in a terminal while logged out, the CLI asks “You’re not logged in to WordPress.com. Log in now?” Answer yes to log in and continue the command. If you answer no, or the command runs without a terminal (for example, from a script), it stops and asks you to log in with `studio auth login`.

Use the `--help` flag for detailed options on any auth command:

studio auth --help
studio auth login --help

## [Preview site commands](#6-preview-site-commands)

[Preview sites](https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/) are temporary, shareable environments hosted on WordPress.com that mirror your local WordPress Studio site. Use them to share work with teammates or stakeholders without requiring a local environment.

studio preview create          # Create a preview site
studio preview list            # List preview sites
studio preview update <host>   # Update an existing preview site
studio preview set <host>      # Configure a preview site, such as its name
studio preview delete <host>   # Delete a preview site

### [Creating a preview site](#7-creating-a-preview-site)

From the root of your local WordPress Studio site:

cd /path/to/your/studio-site
studio preview create

This will:

-   Build and upload your local site to a preview environment.
-   Return a preview URL you can share with others.
-   Require you to be logged in with `studio auth login`.

You can also specify a site directory explicitly:

studio preview create --path /path/to/your/studio-site

### [Listing preview sites](#8-listing-preview-sites)

To view the preview sites of the local site in the current directory:

studio preview list

Add `--all` to list the preview sites of all your local sites, grouped by site. This shows each preview’s host (for example, `example-preview.wp.build`), which you’ll use with the `update` and `delete` commands.

### [Updating and deleting preview sites](#9-updating-and-deleting-preview-sites)

Each preview site is identified by its host name:

\# Rebuild and redeploy changes from your local site to the preview site:
studio preview update <host>

# Permanently remove a preview site:
studio preview delete <host>

# Permanently remove all of your preview sites:
studio preview delete --all

Use `studio preview list` to discover the appropriate `<host>` value if you don’t have it handy.

For the full set of options:

studio preview --help
studio preview create --help
studio preview update --help
studio preview delete --help

## [Local site management commands](#10-local-site-management-commands)

Use these commands to manage local WordPress Studio sites on your machine: creating, starting, stopping, listing, and configuring them.

studio status        # Get status of local site
studio create        # Create a new local site
studio list          # List local sites
studio start         # Start local site
studio stop          # Stop local site(s)
studio delete        # Delete local site(s)
studio config get    # Show site settings
studio config set    # Configure site settings

Earlier versions of WordPress Studio CLI grouped these commands under `studio site` (for example, `studio site create` and `studio site set`). Those forms still work but are deprecated: use `studio create` and `studio config set` instead.

### [Creating a local site](#11-creating-a-local-site)

You can run the `create` command from an empty directory, or a directory that already contains the files of a WordPress site, but one that’s not already listed in WordPress Studio.

To create a new local site managed by WordPress Studio:

\# Create a new site in the current working directory, using all the default options
studio create

# Create a new site with a custom domain and HTTPS
studio create --https --domain hello.wp.local

# Create a new site in a different directory
studio create --path /path/to/site

# Create a new site that keeps WordPress up to date automatically
studio create --wp auto-update

This will create a new site in your current working directory, start the WordPress server, and open the site’s front page in your browser when finished. When the site comes from a Blueprint that sets a `landingPage`, WordPress Studio opens that page instead. Use `--skip-browser` to not open the browser.

There are several supported flags that you can use when creating a new site. For the full set of options:

studio create --help

#### Creating a site from existing content

Use `--from` to build a new site from existing static content: compiled build output, a directory, a zip archive, or a URL. When you pass a URL, WordPress Studio recreates the site from the live website and names it after the captured site title.

\# Create a site from a directory of static files
studio create --from ./build

\# Create a site from a live website
studio create --from https://example.com

### [Creating a local site using Blueprints Gallery](#12-creating-a-local-site-using-blueprints-gallery)

WordPress Studio offers access to the [Blueprints Gallery](https://developer.wordpress.com/docs/developer-tools/studio/blueprints/) where you can choose and activate blueprints to create a site. The Blueprints Gallery is also available through CLI. The commands for working with blueprints are:

\# Show all available blueprints for creating a local WordPress Studio site
studio blueprint list

# Create a local site with selected blueprint
studio blueprint use <blueprint-slug> --name "<site-name>"

### [Listing and inspecting sites](#13-listing-and-inspecting-sites)

\# Show all local sites known to WordPress Studio:
studio list

# Show details and current status for the site in the current directory:
studio status

# Or explicitly for a given path:
studio status --path /path/to/site

Status output includes information such as:

-   Whether the site is running.
-   Local URL (for example, `http://localhost:PORT`).
-   **Email**: the folder where the email the site sends is saved, as `.eml` files.
-   Key configuration details (PHP version, WordPress version, file access, Xdebug, and admin credentials).

### [Starting and stopping sites](#14-starting-and-stopping-sites)

\# From inside a site directory:
studio start
studio stop

# Or by path:
studio start --path /path/to/site
studio stop --path /path/to/site

# Stop every running site:
studio stop --all

Starting a site will launch the local services required to access it in a browser, while stopping it shuts those services down.

### [Deleting a local site](#15-deleting-a-local-site)

\# Delete a site from WordPress Studio and move the site directory to the system trash
studio delete

# Delete the site from WordPress Studio but keep its files on disk
studio delete --no-files

# Delete several sites at once, by path or ID
studio delete /path/to/site-one /path/to/site-two

# Show which sites and files would be deleted, without deleting anything
studio delete /path/to/site-one --dry-run

This removes the site from WordPress Studio and, unless you pass `--no-files`, moves the site files to the trash.

### [Configuring site settings](#16-configuring-site-settings)

Use `studio config set` to adjust settings for a specific local site, and `studio config get` to view them.

studio config set \[options\]
studio config get \[<key>\]

Examples of what `studio config set` can be used for include:

-   Changing the PHP version or WordPress version. Use `--wp auto-update` to let WordPress update itself.
-   Adjusting the site name, custom domain, or HTTPS.
-   Switching file access.
-   Toggling debugging features: Xdebug, the debug log, showing errors in the browser, script debug, and the environment type.

`studio config set --wp <version>` also works on a site that has never been started. If changing the admin credentials fails, WordPress Studio restores the previous credentials and tells you so.

To see the full list of configurable options, run:

studio config set --help

## [Syncing with WordPress.com and Pressable](#cli-sync)

Use `studio push` and `studio pull` to [sync](https://developer.wordpress.com/docs/developer-tools/studio/sync/) a local site with a connected WordPress.com or Pressable site. Both commands require you to be logged in with `studio auth login`.

\# Push the local site to its connected live site
studio push

# Pull the live site into the local site
studio pull

# Choose the live site by URL or ID, and sync only some parts of the site
studio push --remote-site example.com --options plugins,themes

The `--options` flag takes a comma-separated list of `all`, `sqls` (the database), `uploads`, `plugins`, `themes`, and `contents`. For the full set of options:

studio push --help
studio pull --help

## [Importing and exporting](#cli-import-export)

Use `studio import` and `studio export` to work with [backup files](https://developer.wordpress.com/docs/developer-tools/studio/import-export/) from the command line.

\# Import a backup file into the local site
studio import /path/to/backup.zip

# Export the full site
studio export /path/to/backup.zip

# Export only the database
studio export /path/to/database.sql --mode db

Exports can use `.zip` or `.tar.gz`, and database-only exports can also use `.sql`. Use `--mode content` to export only the site content. For the full set of options:

studio export --help

## [WordPress Studio in your browser](#cli-ui)

`studio ui` starts the WordPress Studio interface as a local web app and opens it in your browser. It shows the same sites, chats, and site preview as the desktop app, including attachments and generated images in WordPress Studio Code.

studio ui

# Use a specific port, without opening the browser
studio ui --port 8080 --no-open

Press Ctrl+C in the terminal to stop it.

## [MCP server](#cli-mcp)

`studio mcp` runs WordPress Studio’s MCP server, which lets AI agents create, configure, and inspect your local sites and work with your WordPress.com sites. It also serves WordPress Studio’s instructions and skills to the agent on demand. You don’t usually run it yourself: add it to your agent’s MCP configuration instead. See [MCP on WordPress Studio](https://developer.wordpress.com/docs/developer-tools/studio/mcp-on-studio/).

## [WordPress Studio Code](#cli-code)

`studio code` starts [WordPress Studio Code](https://developer.wordpress.com/docs/developer-tools/studio/studio-code/), WordPress Studio’s AI agent, as a chat in your terminal. `studio ai` works too.

studio code                            # Start a new chat
studio code "Create a portfolio site"  # Start with a first message
studio code sessions list              # List saved chats
studio code sessions resume latest     # Resume the most recent chat
studio code sessions delete <id>       # Delete a saved chat

`sessions resume` and `sessions delete` take a session ID, an ID prefix, or `latest`, and show a picker when you leave it out. For the full set of options:

studio code --help

## [Using WP-CLI through WordPress Studio](#22-using-wp-cli-through-studio)

The `studio wp` command gives you access to WP-CLI within the context of a WordPress Studio-managed site, without requiring you to install or configure WP-CLI separately.

studio wp \[<wp-cli-command>\] \[<wp-cli-arguments>...\]

Examples (run from your site’s root directory):

\# Check WordPress version:
studio wp core version

# List installed plugins:
studio wp plugin list

# Run database upgrades:
studio wp core update-db

Key points:

-   You don’t need a separate WP-CLI installation; WordPress Studio provides and configures it for you.
-   Environment variables, paths, and credentials are automatically set based on the selected site, so commands operate on the correct database and files.
-   You can use `--path` if you’re not in the site directory:

  studio wp plugin list --path /path/to/site

For a complete list of supported WP-CLI subcommands and arguments, refer to the [WP-CLI documentation](https://developer.wordpress.org/cli/commands/) or run:

studio wp help
studio wp help <command>

## [Using WordPress Studio CLI with AI coding agents](#23-using-studio-cli-with-ai-coding-agents)

The WordPress Studio CLI works well with AI-assisted development tools and agents such as **Claude Code**, **Cursor**, and other IDE extensions that can run shell commands on your behalf.

Because these tools can see your project files and execute terminal commands, they can:

-   Detect that you are working in a WordPress Studio-managed WordPress project.
-   Call `studio` commands automatically to manage local sites, previews, and WP-CLI tasks.
-   Use command output to guide further code changes or debugging steps.

### [Typical workflows with AI agents](#24-typical-workflows-with-ai-agents)

Below are some concrete ways to combine WordPress Studio CLI with an AI coding agent.

#### 1\. Spinning up and managing a local site

You can instruct your AI agent to create and run a local WordPress site via WordPress Studio. For example, in your editor:

*“Set up a new local WordPress site using PHP version 8.2 using WordPress Studio in this folder, start it, and tell me the local URL.”*

Behind the scenes, the agent might run:

studio create --php 8.2
studio start
studio status

This is useful when:

-   Quickly prototyping a new plugin or theme.
-   Onboarding to an existing project where you want the agent to set up the environment for you.

#### 2\. Automated debugging and WP-CLI operations

When the agent suggests a fix or change, it can also run checks using `studio wp`:

\# Run database upgrades:
studio wp core update-db

# Check for current plugins:
studio wp plugin list

You might ask:

*“Run whatever WP-CLI checks you need through WordPress Studio to diagnose why the site is throwing a 500 error, then propose fixes.”*

The agent can iteratively:

1.  Run `studio wp` commands to gather diagnostics.
2.  Update code or configuration.
3.  Re-run commands to verify the fix.

#### 3\. Creating and updating preview sites for review

Agents can help you set up and maintain preview environments tied to your branch or feature:

*“Create a preview site for this project and give me the shareable URL. Then, after each code change, update the same preview.”*

Which translates to:

studio auth login              # if needed
studio preview create          # initial deployment
studio preview update <host>   # after subsequent changes

`studio preview create` validates the site, archives and uploads it, and prints the preview link:

```text
✔ Archive created
✔ Archive uploaded
✔ Preview site available at: https://wrenandbarley.wp.build
✔ Preview site saved to Studio
```

This is particularly useful when:

-   Sharing progress with non-technical stakeholders.
-   Collaborating with teammates who need to see live behavior without setting up a local environment.

### [Best practices when using AI agents with WordPress Studio CLI](#25-best-practices-when-using-ai-agents-with-studio-cli)

-   **Stay in a WordPress Studio site root**: Many commands assume the current directory is a WordPress Studio-managed site. Remind your agent to `cd` into the correct folder or to use `--path`.
-   **Be explicit in instructions**: When prompting an agent, mention “use the `studio` CLI” and any constraints, for example:
    -   “Don’t delete existing sites.”
    -   “Ask for confirmation before running database migrations.”
    -   “Only run read-only `studio wp` commands.”
-   **Review destructive operations**: Commands like `studio delete` and `studio preview delete` can remove environments. Ask the agent to show the commands it plans to run before executing them.
-   **Use authentication deliberately**: For commands that require WordPress.com access (`studio auth login`, `studio preview ...`), ensure you’re comfortable with the agent initiating login flows, and confirm which account is being used.

By combining WordPress Studio CLI with AI coding agents, you can offload much of the repetitive environment setup, testing, and deployment orchestration, and focus more on writing and reviewing your WordPress code.

## [Getting help](#26-getting-help)

Every command and subcommand supports `--help` for inline documentation, usage, and available options. For example:

studio --help
studio auth --help
studio preview create --help
studio start --help
studio config set --help
studio wp help

This is the best way to explore the capabilities of the specific version of WordPress Studio CLI you have installed.