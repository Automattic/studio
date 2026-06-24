import fs from 'fs';
import path from 'path';

/**
 * WordPress maintenance mode timeout (600 seconds = 10 minutes).
 * Matches WP_INSTALLING_TIMEOUT in wp-includes/load.php.
 */
const WP_MAINTENANCE_TIMEOUT_SECONDS = 600;

export interface MaintenanceFileInfo {
	exists: true;
	filePath: string;
	upgradingTimestamp: number;
	isStale: boolean;
	expiresAt: Date | null;
}

export interface NoMaintenanceFile {
	exists: false;
}

export type MaintenanceFileCheck = MaintenanceFileInfo | NoMaintenanceFile;

/**
 * Check for a WordPress .maintenance file and parse its $upgrading timestamp.
 * WordPress creates this file during core/plugin/theme updates with the format:
 * <?php $upgrading = <unix_timestamp>; ?>
 */
export function checkMaintenanceFile( sitePath: string ): MaintenanceFileCheck {
	const filePath = path.join( sitePath, '.maintenance' );

	if ( ! fs.existsSync( filePath ) ) {
		return { exists: false };
	}

	let content: string;
	try {
		content = fs.readFileSync( filePath, 'utf-8' );
	} catch {
		return {
			exists: true,
			filePath,
			upgradingTimestamp: 0,
			isStale: true,
			expiresAt: null,
		};
	}

	const match = content.match( /\$upgrading\s*=\s*(\d+)/ );
	if ( ! match ) {
		return {
			exists: true,
			filePath,
			upgradingTimestamp: 0,
			isStale: true,
			expiresAt: null,
		};
	}

	const upgradingTimestamp = parseInt( match[ 1 ], 10 );
	const ageSeconds = Date.now() / 1000 - upgradingTimestamp;
	const isStale = ageSeconds > WP_MAINTENANCE_TIMEOUT_SECONDS;

	return {
		exists: true,
		filePath,
		upgradingTimestamp,
		isStale,
		expiresAt: isStale
			? null
			: new Date( ( upgradingTimestamp + WP_MAINTENANCE_TIMEOUT_SECONDS ) * 1000 ),
	};
}
