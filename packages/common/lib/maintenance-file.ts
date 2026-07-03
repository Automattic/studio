import fs from 'fs';
import path from 'path';

/**
 * WordPress maintenance mode timeout (600 seconds = 10 minutes).
 * Matches WP_INSTALLING_TIMEOUT in wp-includes/load.php.
 */
const WP_MAINTENANCE_TIMEOUT_SECONDS = 600;

export interface MaintenanceFileInfo {
	exists: true;
	isStale: boolean;
}

export interface NoMaintenanceFile {
	exists: false;
}

export type MaintenanceFileCheck = MaintenanceFileInfo | NoMaintenanceFile;

/**
 * Check for a WordPress .maintenance file and parse its $upgrading timestamp.
 * WordPress creates this file during core/plugin/theme updates with the format:
 * <?php $upgrading = <unix_timestamp>; ?>
 *
 * WordPress itself ignores the file after 10 minutes (WP_INSTALLING_TIMEOUT),
 * so only fresh locks actually block requests.
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
		// Unreadable file — treat as stale (won't block WordPress either).
		return { exists: true, isStale: true };
	}

	const match = content.match( /\$upgrading\s*=\s*(\d+)/ );
	if ( ! match ) {
		// Malformed file — treat as stale.
		return { exists: true, isStale: true };
	}

	const upgradingTimestamp = parseInt( match[ 1 ], 10 );
	const ageSeconds = Date.now() / 1000 - upgradingTimestamp;

	return {
		exists: true,
		isStale: ageSeconds > WP_MAINTENANCE_TIMEOUT_SECONDS,
	};
}
