# wp-now

`wp-now` streamlines the process of setting up a local WordPress environment.

It uses automatic mode detection to provide a fast setup process, regardless of whether you're working on a plugin or an entire site. You can easily switch between PHP and WordPress versions with just a configuration argument. Under the hood, `wp-now` is powered by WordPress Playground and only requires Node.js.

![Demo GIF of wp-now](https://github.com/WordPress/wordpress-playground/assets/36432/474ecb85-d789-4db9-b820-a19c25da79ad)

## Table of Contents

-   [Requirements](#requirements)
-   [Usage](#usage)
    -   [Automatic Modes](#automatic-modes)
    -   [Arguments](#arguments)
-   [Technical Details](#technical-details)
-   [Using Blueprints](#using-blueprints)
    -   [Defining Custom URLs](#defining-custom-urls)
    -   [Defining Debugging Constants](#defining-debugging-constants)
-   [Known Issues](#known-issues)
-   [Comparisons](#comparisons)
    -   [Laravel Valet](#laravel-valet)
    -   [wp-env](#wp-env)
-   [Contributing](#contributing)
-   [Testing](#testing)
-   [Publishing](#publishing)

## Requirements

Node 18 is the minimum supported version. Node 20 is required for Blueprint support.

## Usage

<img src="../../assets/wp-now-basics-diagram.png" width="600">

To run `wp-now` with one command, you can use [npx](https://docs.npmjs.com/cli/v10/commands/npx):

```bash
npx @wp-now/wp-now start
```

You can also install `@wp-now/wp-now` globally to just run `wp-now` from any directory:

```bash
npm install -g @wp-now/wp-now
```

Lastly, you can install `wp-now` via `git clone` if you'd like to hack on it too. See [Contributing](#contributing) for more details.

Once installed, you can start a new server like so:

```bash
cd wordpress-plugin-or-theme
wp-now start
```

Use the `--php=<version>` and `--wp=<version>` arguments to switch to different versions on the fly:

```bash
wp-now start --wp=5.9 --php=7.4
```

For the modes that support it, `wp-now` will create a persistent SQLite database and `wp-content` directory in `~/.wp-now`. Use the `--reset` argument to create a fresh project.

Use `wp-now php <file>` to execute a specific PHP file:

```bash
cd wordpress-plugin-or-theme
wp-now php my-file.php
```

### Automatic Modes

`wp-now` automatically operates in a few different modes for both the `start` and the `php` commands. The selected mode depends on the directory in which it is executed:

-   **plugin**, **theme**, or **wp-content**: Loads the project files into a virtual filesytem with WordPress and a SQLite-based database. Everything (including WordPress core files, the database, `wp-config.php`, etc.) is stored in the user's home directory and loaded into the virtual filesystem. The latest version of WordPress will be used, unless the `--wp=<version>` argument is provided. Here are the heuristics for each mode:
    -   **plugin** mode: Presence of a PHP file with 'Plugin Name:' in its contents.
    -   **theme** mode: Presence of a `style.css` file with 'Theme Name:' in its contents.
    -   **wp-content** mode: Presence of `plugins` and `themes` subdirectories.
-   **wordpress**: Runs the directory as a WordPress installation when WordPress files are detected. An existing `wp-config.php` file will be used if it exists; if it doesn't exist, it will be created along with a SQLite database.
-   **wordpress-develop**: Same as `wordpress` mode, except the `build` directory is served as the web root.
-   **index**: When an `index.php` file is present, starts a PHP webserver in the working directory and simply passes requests to the `index.php`.
-   **playground**: If no other conditions are matched, launches a completely virtualized WordPress site.

### Arguments

`wp-now start` currently supports the following arguments:

-   `--path=<path>`: the path to the PHP file or WordPress project to use. If not provided, it will use the current working directory;
-   `--php=<version>`: the version of PHP to use. This is optional and if not provided, it will use a default version which is `8.0`(example usage: `--php=7.4`);
-   `--port=<port>`: the port number on which the server will listen. This is optional and if not provided, it will pick an open port number automatically. The default port number is set to `8881`(example of usage: `--port=3000`);
-   `--wp=<version>`: the version of WordPress to use. This is optional and if not provided, it will use a default version. The default version is set to the [latest WordPress version](https://wordpress.org/download/releases/)(example usage: `--wp=5.8`)
-   `--blueprint=<path>`: the path of a JSON file with the Blueprint steps (requires Node 20). This is optional, if provided will execute the defined Blueprints. See [Using Blueprints](#using-blueprints) for more details.
-   `--reset`: create a fresh SQLite database and wp-content directory, for modes that support persistence.

Of these, `wp-now php` currently supports the `--path=<path>` and `--php=<version>` arguments.

## Technical Details

-   The `~/.wp-now` home directory is used to store the WP versions and the `wp-content` folders for projects using 'theme', 'plugin', 'wp-content', and 'playground' modes. The path to `wp-content` directory for the 'plugin', 'theme', and 'wp-content' modes is `~/.wp-now/wp-content/${projectName}-${directoryHash}`. 'playground' mode shares the same `~/.wp-now/wp-content/playground` directory, regardless of where it's started.
-   For the database setup, `wp-now` is using [SQLite database integration plugin](https://wordpress.org/plugins/sqlite-database-integration/). The path to SQLite database is ` ~/.wp-now/wp-content/${projectName}-${directoryHash}/database/.ht.sqlite`

## Using Blueprints

Blueprints are JSON files with a list of steps to execute after starting wp-now. They can be used to automate the setup of a WordPress site, including defining wp-config constants, installing plugins, themes, and content. [Learn more about Blueprints.](https://wordpress.github.io/wordpress-playground/blueprints-api/index)

### Defining Custom URLs

Here is an example of a Blueprint that defines custom URL constant. `wp-now` will automatically detect the blueprint and execute it after starting the server. In consequence, the site will be available at `http://myurl.wpnow`. Make sure myurl.wpnow is added to your hosts file.

To execute this Blueprint, create a file named `blueprint-example.json` and run `wp-now start --blueprint=path/to/blueprint-example.json`. Note that the `virtualize` is set to `true` to avoid modifying the `wp-config.php` file that is shared between all the projects.

```json
{
	"steps": [
		{
			"step": "defineWpConfigConsts",
			"consts": {
				"WP_HOME": "http://myurl.wpnow:8881",
				"WP_SITEURL": "http://myurl.wpnow:8881"
			},
			"method": "define-before-run"
		}
	]
}
```

This step can be also used along with `ngrok`, in this case you can run `ngrok http 8881`, copy the ngrok URL and replace `WP_HOME` and `WP_SITEURL` in the blueprint file.

If you prefer to use a different port, you can use the `--port` argument when starting the server.
`wp-now start --blueprint=path/to/blueprint-example.json --port=80`

The Blueprint to listen on port `80` will look like this:

```json
{
	"steps": [
		{
			"step": "defineWpConfigConsts",
			"consts": {
				"WP_HOME": "http://myurl.wpnow",
				"WP_SITEURL": "http://myurl.wpnow"
			},
			"method": "define-before-run"
		}
	]
}
```

### Defining Debugging Constants

In the similar way we can define `WP_DEBUG` constants and read the debug logs.

Run `wp-now start --blueprint=path/to/blueprint-example.json` where `blueprint-example.json` is:

```json
{
	"steps": [
		{
			"step": "defineWpConfigConsts",
			"consts": {
				"WP_DEBUG": true,
				"WP_DEBUG_LOG": true
			},
			"method": "define-before-run"
		}
	]
}
```

This will enable the debug logs and will create a `debug.log` file in the `~/.wp-now/wp-content/${project}/debug.log` directory.

If you prefer to set a custom path for the debug log file, you can set `WP_DEBUG_LOG` to be a directory. Remember that the `php-wasm` server runs udner a VFS (virtual file system) where the default documentRoot is always `/var/www/html`.

For example, if you run `wp-now start --blueprint=path/to/blueprint-example.json` from a theme named `atlas` you could use this directory: `/var/www/html/wp-content/themes/atlas/example.log` and you will find the `example.log` file in your project directory.

```json
{
	"steps": [
		{
			"step": "defineWpConfigConsts",
			"consts": {
				"WP_DEBUG_LOG": "/var/www/html/wp-content/themes/atlas/example.log"
			},
			"method": "define-before-run"
		}
	]
}
```

## Known Issues

-   Running `wp-now start` in 'wp-content' or 'wordpress' mode will produce some empty directories: [WordPress/wordpress-playground#328](https://github.com/WordPress/wordpress-playground/issues/328)
-   Inline images are broken when site starts on a different port: [WordPress/wordpress-playground#356](https://github.com/WordPress/wordpress-playground/issues/356)
-   `wp-now` doesn't build or start on Windows: [WordPress/playground-tools#66](https://github.com/WordPress/playground-tools/issues/66), [WordPress/playground-tools#11](https://github.com/WordPress/playground-tools/issues/11)
-   Pretty permalinks aren't yet supported: [WordPress/playground-tools#53](https://github.com/WordPress/playground-tools/issues/53)
-   It's not possible to set `WP_DEBUG` and other `wp-config.php` constants: [WordPress/playground-tools#17](https://github.com/WordPress/playground-tools/issues/17)
-   In 'wordpress' mode, `wp-now` can connect to a MySQL database with `define( 'DB_HOST', '127.0.0.1' );`, but `define( 'DB_HOST', 'localhost' );` does not work: [WordPress/wordpress-playground#369](https://github.com/WordPress/wordpress-playground/issues/369)
-   `wp-now` published versions can appear random: [WordPress/wordpress-playground#357](https://github.com/WordPress/wordpress-playground/issues/357)

## Comparisons

### Laravel Valet

If you are migrating from Laravel Valet, you should be aware of the differences it has with `wp-now`:

-   `wp-now` does not require you to install WordPress separately, create a database, connect WordPress to that database or create a user account. All of these steps are handled by the `wp-now start` command and are running under the hood;
-   `wp-now` works across all platforms (Mac, Linux, Windows);
-   `wp-now` does not support custom domains or SSL (yet!);
-   `wp-now` works with WordPress themes and plugins even if you don't have WordPress installed;
-   `wp-now` allows to easily switch the WordPress version with `wp-now start --wp=version.number`(make sure to replace the `version.number` with the actual WordPress version);
-   `wp-now` does not support Xdebug PHP extension (yet!)

Some similarities between Laravel Valet and `wp-now` to be aware of:

-   could be used for non-WordPress projects;
-   deployments are not possible with neither Laravel Valet, nor `wp-now`;
-   possible to switch easily the PHP version;
-   possibility to work on multiple WordPress sites simultaneously

### wp-env

If you are migrating from `wp-env`, you should be aware of the differences it has with `wp-now`:

-   `wp-now` supports non-WordPress projects;
-   `wp-now` does not need Docker;
-   `wp-now` does not support Xdebug PHP extension (yet!);
-   `wp-now` does not include Jest for automatic browser testing

Some similarities between `wp-env` and `wp-now` to be aware of:

-   no support for custom domains or SSL;
-   `plugin`, `themes` and index modes are available on `wp-env` and `wp-now`;
-   deployments are not possible with neither `wp-env`, nor `wp-now`;
-   possible to switch easily the PHP version

## Contributing

We welcome contributions from the community!

In order to contribute to `wp-now`, you'll need to first install a few global dependencies:

-   Make sure you have `nvm` installed. If you need to install it first,
    [follow these installation instructions](https://github.com/nvm-sh/nvm#installation).
-   Install `nx` by running `npm install -g nx`.

Once the global dependencies are installed, you can start using the repo:

```bash
git clone git@github.com:WordPress/playground-tools.git
cd playground-tools
nvm use
npm install
npm run build
nx preview wp-now start --path=/path/to/wordpress-plugin-or-theme
```

If you'd like to make the `wp-now` executable globally available when using this installation method, run `npm link`. It's not particularly reliable, however.

## Testing

To run the unit tests, use the following command:

```bash
nx test wp-now
```

## Publishing

The `wp-now` package is part of a larger monorepo, sharing its space with other sibling packages. To publish the `wp-now` package to npm, you must first understand the automated release process facilitated by lerna. This process includes automatically incrementing the version number, creating a new tag, and publishing all modified packages to npm simultaneously. Notably, all published packages share the same version number.

Each package identifies a distinct organization in its `package.json` file. To publish the `wp-now` package, you need access to the `@wp-now` npm organization.

To initiate the publishing process for `wp-now`, execute the following commands:

```bash
npm login # this is required only once and it will store the credentials in ~/.npmrc file.
npm run build
npm run release:wp-now
```
