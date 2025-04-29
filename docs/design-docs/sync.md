# Sync WordPress Studio Sites

## About this doc

This design document describes the requirements, architecture, and data models for the **Studio Sync** feature.

## Context

WordPress Studio Sync enables developers to pull a live site down for local development (including themes, plugins, media, and the database) and then push changes back without manual exports or FTP. It supports both WordPress.com and Pressable sites with a Jetpack connection.

## Terminology

- **Sync**: Replicating files and database content between a local machine and a remote site in any direction.
- **Push**: Copying changes from a local machine to a remote (staging or production) site.
- **Pull**: Copying changes from a remote site down to a local machine.
- **Staging site**: A staging site is hosted on WordPress.com and is connected to its production site. WordPress.com staging sites can sync with production sites and vice versa; however, that is a different feature managed entirely in the wp.com Hosting Features web interface.
- **Production site**: A production site hosted on WordPress.com or any Pressable site. For Pressable sites, we currently cannot identify if a site is a production or staging and we don't display any tag or label for them.
- **Jetpack Backup**: A feature of WordPress.com that allows users to back up their sites and serves as the format used to share site data for the sync feature.
- **Sync connection**: A Sync connection is a relationship between a local machine and a remote site. That information lives in appData `connectedWpcomSites` array.

### Backup format

The backup format is a tar.gz file that contains the site data. It follows the format of the Jetpack Backup, which consists of:

- `wp-content/` folder
- `sql/` folder with a `.sql` file for each database table
- `wp-config.php` file
- `meta.json` file

## High level implementation

### Sync Connection

In order to sync, users must first connect a remote site to their local Studio site. When users click on "Connect site" in Studio, a modal will open to select the remote site. The list of sites is fetched from the WPcom API at `/me/sites` and will include all their simple, atomic, and Jetpack sites.

Compatible sites:

- WPcom sites with a Business or eCommerce plan.
- Pressable sites with a valid Jetpack connection.

Only WPcom sites with a Business or eCommerce plan can be connected. If a site with the Business plan does not have hosting features enabled, we will ask the user to do so before using Studio sync feature. Additionally, Pressable sites with a valid Jetpack connection can also be connected to Studio.

WordPress.com production and staging sites are grouped when users connect a production site, meaning they can easily sync with both sites from Studio.
For Pressable sites, we currently cannot identify if a site is a production or staging.

Users can connect multiple sites to Studio independently of their hosting provider.

### Pull

When the user clicks "Pull," we make a request to the WPcom API to run a Jetpack Backup and generate a download link. We poll the API until the process is ready to download the backup file.

Studio will download the backup file and save it on the local machine in a temporary folder.

It will run the import process to extract the backup file and save the data in the local database by executing the WP-CLI sqlite import command. The former site will be completely replaced by the new one.

### Push

When the user clicks "Push," Studio will create a Jetpack backup of the local site. Studio then uploads the file to the WPcom API and polls until the restore process is complete. The former site will be completely replaced by the new one.

An email notification will be sent from the backend after the Push has finished.

## Limitations

Currently, Studio Sync does not support selective syncing of specific site elements, such as syncing only a single plugin, specific folder, or table. All sync operations involve the entire site, including the full database and wp-content files.

The limit for Jetpack Backup when pushing is 2GB.
