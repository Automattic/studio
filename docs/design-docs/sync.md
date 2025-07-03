# Sync WordPress Studio Sites

## About this doc

This design document describes the requirements, architecture, and data models for the **Studio Sync** feature.

## Context

WordPress Studio Sync enables developers to pull a live site down for local development (including themes, plugins, media, and the database) and then push changes back without manual exports or FTP. It supports both WordPress.com and Pressable sites with a Jetpack connection.

## Terminology

- **Sync**: Replicating files and database content between a local machine and a remote site in any direction. A partial sync is also possible, meaning that only certain files and folders or the database can be synced.
- **Push**: Copying changes from a local machine to a remote (staging or production) site.
- **Pull**: Copying changes from a remote site down to a local machine.
- **Staging site**: A staging site hosted on WordPress.com or a Pressable site with the environment type set to `staging`. WordPress.com staging sites can sync with production sites and vice versa. However, that is a different feature managed entirely in the WordPress.com Hosting Features web interface.
- **Production site**: A production site hosted on WordPress.com or a Pressable site with the environment type set to `production`.
- **Jetpack Backup**: A feature of WordPress.com that allows users to back up their sites and serves as the format used to share site data for the sync feature.
- **Sync connection**: A Sync connection is a relationship between a local machine and a remote site. That information lives in appData `connectedWpcomSites` array.

### Backup format

The backup format is a tar.gz file that contains the site data. It follows the format of the Jetpack Backup, which consists of:

- `wp-content/` folder
- `sql/` folder with a `.sql` file for each database table
- `wp-config.php` file
- `meta.json` file

Folders in the archive are optional. If any are missing, they will simply be ignored, allowing for partial syncs. The Jetpack backup process is non-destructive: existing files will not be deleted.

## High level implementation

### Sync Connection

In order to sync, users must first connect a remote site to their local Studio site. When users click on "Connect site" in Studio, a modal will open to select the remote site. The list of sites is fetched from the WPcom API at `/me/sites` and will include all their simple, atomic, and Jetpack sites.

Compatible sites:

- WPcom sites with a Business or eCommerce plan.
- Pressable sites with a valid Jetpack connection.

Only WPcom sites with a Business or eCommerce plan can be connected. If a site with the Business plan does not have hosting features enabled, we will ask the user to do so before using Studio sync feature. Additionally, Pressable sites with a valid Jetpack connection can also be connected to Studio.

WordPress.com production and staging sites are grouped when users connect a production site, meaning they can easily sync with both sites from Studio.

Pressable production and staging sites are not grouped together on the Studio side. They are displayed as separate connected sites.

Users can connect multiple sites to Studio independently of their hosting provider.

### Pull

When the user clicks **Pull**, Studio opens a sync dialog that allows them to select exactly which data to synchronize from the remote site to their local environment.

By default, all files and the database are pre-selected. Users can customize the sync options by opening a dropdown and selecting specific files and folders to pull. The file tree is then displayed with wp-content as the root, enabling selective syncing of specific parts of the site.

The available options are:

- **wp-content**: Select this to pull all of the content from your site. This operation will overwrite the local folders with the contents from the backup, including the themes, plugins, and uploads folders. Other existing files and folders will be ignored and not overwritten.
  - **plugins**: Pull all plugins from the remote site. This replaces any local plugins folder with the new ones found in the backup.
  - **themes**: Pull all themes from the remote site. Like plugins, this replaces any existing local themes folder with the new ones found in the backup.
  - **uploads**: Pull the media library (wp-content/uploads) from the remote site. This option will overwrite the local site’s uploads directory with the files from the backup.
  - **Other files and directories**: Pull all other files and folders inside wp-content that are not covered by the options above (for example, mu-plugins, fonts, etc.). This ensures custom or less-common directories can also be selectively synchronized.
- **database**: Pull the database from the remote site. This will overwrite the local database with the one from the backup. The database will be updated by running the WP-CLI sqlite import command.

When the user clicks **Pull**, Studio sends a request to the WPcom API to create a Jetpack Backup and generate a download link. Studio polls the API until the backup is ready, download the file to a temporary folder, and extract its contents.

The backup file includes only the options selected by the user. Once extracted, the corresponding changes are applied locally. If a full sync is selected, the local site is completely replaced, including the database. If only specific parts are selected, only those are updated.

### Push

When the user clicks **Push**, Studio opens a sync dialog allowing them to choose exactly which data to synchronize from their local site to the remote environment.

By default, all files and the database are pre-selected. Users can customize the sync options by opening a dropdown and selecting specific files and folders to push. The file tree is then displayed with wp-content as the root, enabling selective syncing of specific parts of the site.

See the Pull section for more details on the available options.

When the user initiates the push, Studio creates a backup archive containing only the files and database tables the user has selected. Studio then uploads this backup to the WPcom API, which restores the selected components on the remote site. The process is non-destructive: existing files and data not included in the backup are left unchanged.

An email notification will be sent from the backend after the Push has finished, informing the user that the push is complete and which options were pushed.

## Limitations

Currently, Studio Sync does not support selective syncing of specific site elements, such as syncing only a single plugin, specific folder, or table. All sync operations involve the entire site, including the full database and wp-content files.

The limit for Jetpack Backup when pushing is 2GB.
