# Sync WordPress Studio Sites

## About this doc

This design doc describes the requirements, architecture, and data models for the **Studio Sync** feature.

## Context

WordPress Studio sync enables developers to pull a live site down for local development (themes, plugins, media, and database) and then push changes back up without manual exports or FTP. It supports both WordPress.com and Pressable sites with a Jetpack connection.

## Terminology

### Sync

Replicating files and database content between a local machine and a remote site in any direction.

### Push

Copying changes from a local machine to a remote (staging or production) site.

### Pull

Copying changes from a remote site down to a local machine.

### Staging site

A staging site is hosted on WordPress.com and is connected to the production site. It is used to test the sync feature and serves as the source of truth for this feature. WordPress.com staging sites can sync with production sites and vice versa.

### Production site

The production site is hosted on WordPress.com and is used to store the synced site. We consider all Pressable sites as production servers.

### Jetpack Backup

Jetpack Backup is a feature of WordPress.com that allows users to back up their sites and serves as the format used to share site data for the sync feature.

## High level implementation

### Backup format

### Data Flow
