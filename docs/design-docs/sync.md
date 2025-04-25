# Sync WordPress Studio Sites

## About this doc

This design document describes the requirements, architecture, and data models for the **Studio Sync** feature.

## Context

WordPress Studio Sync enables developers to pull a live site down for local development (including themes, plugins, media, and the database) and then push changes back up without manual exports or FTP. It supports both WordPress.com and Pressable sites with a Jetpack connection.

## Terminology

- **Sync**: Replicating files and database content between a local machine and a remote site in any direction.
- **Push**: Copying changes from a local machine to a remote (staging or production) site.
- **Pull**: Copying changes from a remote site down to a local machine.
- **Staging site**: A staging site is hosted on WordPress.com and is connected to the production site. It is used to test the sync feature and serves as the source of truth for this feature. WordPress.com staging sites can sync with production sites and vice versa.
- **Production site**: A production site is hosted on WordPress.com and is used to store the synced site. We consider all Pressable sites as production servers.
- **Jetpack Backup**: A feature of WordPress.com that allows users to back up their sites and serves as the format used to share site data for the sync feature.
- **Connection**: A connection is a relationship between a local machine and a remote site. That information lives in appData `connectedWpcomSites` array.

### Backup format

The backup format is a tar.gz file that contains the site data. It follows the format of the Jetpack Backup, which consists of:

- wp-content folder
- sql folder with a .sql file for each database table
- wp-config.php file
- meta.json file

## High level implementation

### Connection

Users need to connect a remote site to their local Studio site. When users click on "Connect a Site," a modal will open to select the remote site. The list of sites is fetched from the WPcom API at /me/sites and will include all their simple, atomic, and Jetpack sites.

Compatible sites:

- WPcom sites with a Business or eCommerce plan.
- Pressable sites with a valid Jetpack connection.

Only WPcom sites with a Business or eCommerce plan can be connected. If the site is Business but simple, we will ask the user to enable the Hosting Features. Additionally, Pressable sites with a valid Jetpack connection can also be connected to Studio.

When a WPcom production site is connected, we will also connect the staging site automatically if it exists.
For Pressable sites, we cannot identify if a site is a production or staging.

Users can connect multiple sites to Studio independently of their hosting provider.

### Pull

When the user clicks "Pull," we make a request to the WPcom API to start the Jetpack Backup process. We actively listen until the process is ready to download the backup file.

The studio will download the backup file and save it on the local machine in a temporary folder.

It will run the import process to extract the backup file and save the data in the local database by executing the WP-CLI sqlite import command.

### Push

When the user clicks "Push," Studio will create a Jetpack backup of the local site. Studio sends a request to the WPcom API to start uploading the backup file, and then an active listener starts to wait until the restore process is complete.

The backend will send an email after the Push has finished.
