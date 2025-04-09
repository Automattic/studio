import { shell } from 'electron';
import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import { pathExists, recursiveCopyDirectory } from 'src/lib/fs-utils';
import { getSiteUrl } from 'src/lib/get-site-url';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';

/**
 * Sets up the adminer files for the site.
 *
 * @param {SiteDetails} siteDetails - The site details.
 * @returns {Promise<void>}
 */
export async function setupAdminer( siteDetails: SiteDetails ) {
	try {
		const adminerPath = nodePath.join( siteDetails.path, 'adminer' );
		const sourceVersionPath = 'vendor/adminer/version.txt';
		const destVersionPath = `${ adminerPath }/version.txt`;

		// Check if we need to update
		let shouldUpdate = false;

		try {
			const exists = await pathExists( adminerPath );
			console.log( 'exists', exists );
			if ( ! exists ) {
				shouldUpdate = true;
			} else {
				/*
				 * Check if the version is the same.
				 * This is to ensure that any code updates
				 * are propagated to the site.
				 */
				const sourceVersion = await fs.promises.readFile( sourceVersionPath, 'utf8' );
				const destVersion = await fs.promises.readFile( destVersionPath, 'utf8' );

				if ( typeof sourceVersion !== 'string' || typeof destVersion !== 'string' ) {
					shouldUpdate = true;
				} else {
					shouldUpdate = sourceVersion.trim() !== destVersion.trim();
				}
			}
		} catch ( error ) {
			// If any error occurs during version check, force an update
			console.error( 'Error checking adminer versions:', error );
			shouldUpdate = true;
		}

		if ( shouldUpdate ) {
			// Update translations.php.
			const translationsPhpContent = `<?php
				return array(
					'openSite' => '${ __( 'Open site' ) }',
					'siteTables' => '${ __( 'Site tables' ) }', 
				);
			`;
			const translationsPath = 'vendor/adminer/translations.php';
			try {
				await fs.promises.writeFile( translationsPath, translationsPhpContent );
			} catch ( translationsError ) {
				throw new Error(
					'Failed to update adminer translations.php: ' + ( translationsError as Error ).message
				);
			}
			try {
				await recursiveCopyDirectory( 'vendor/adminer', adminerPath );
			} catch ( copyError ) {
				throw new Error( `Failed to copy adminer directory: ${ ( copyError as Error ).message }` );
			}

			// Update config.php with site details.
			await updateAdminerConfig( siteDetails );
		}
	} catch ( error ) {
		console.error( 'Error setting up adminer:', error );
		throw error;
	}
}

/**
 * Updates the adminer config.php file with the site details.
 *
 * @param {SiteDetails} siteDetails - The site details.
 * @returns {Promise<void>}
 */
export async function updateAdminerConfig( siteDetails: SiteDetails ) {
	const originalConfigPath = 'vendor/adminer/config.php';
	const adminerPath = nodePath.join( siteDetails.path, 'adminer' );
	const destinationConfigPath = nodePath.join( adminerPath, 'config.php' );
	const userLocale = await getUserLocaleWithFallback();

	// Copy the original config.php file to the adminer directory.
	await fs.promises.copyFile( originalConfigPath, destinationConfigPath );

	try {
		const config = await fs.promises.readFile( destinationConfigPath, 'utf8' );
		const siteUrl = getSiteUrl( siteDetails );
		await fs.promises.writeFile(
			destinationConfigPath,
			config
				.replace( '{ADMINER_WP_SITE_URL}', siteUrl )
				.replace( '{ADMINER_LOCALE}', userLocale )
				.replace( '{ADMINER_WP_SITE_NAME}', siteDetails.name )
		);
	} catch ( configError ) {
		throw new Error( 'Failed to update adminer config.php: ' + ( configError as Error ).message );
	}
}

/**
 * Deletes the adminer files from the site.
 * This is used when the site is deleted.
 *
 * @param {SiteDetails} siteDetails - The site details.
 * @returns {Promise<void>}
 */
export async function deleteAdminer( siteDetails: SiteDetails ) {
	const adminerPath = nodePath.join( siteDetails.path, 'adminer' );
	try {
		// Move files to trash
		await shell.trashItem( adminerPath );
	} catch ( error ) {
		/* We want to exit gracefully if the there is an error deleting the adminer files */
		Sentry.captureException( error );
	}
}
