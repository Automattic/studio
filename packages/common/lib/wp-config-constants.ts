import { getWpEnvironmentType, type WpEnvironmentType } from './wp-environment-type';

/**
 * The wp-config.php constants a site's debug and environment settings set.
 */
export function getSettingsWpConfigConstants( site: {
	enableDebugLog?: boolean;
	enableDebugDisplay?: boolean;
	enableScriptDebug?: boolean;
	environmentType?: WpEnvironmentType;
} ): Record< string, boolean | string > {
	const enableDebugLog = site.enableDebugLog ?? false;
	const enableDebugDisplay = site.enableDebugDisplay ?? false;
	return {
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
		// SCRIPT_DEBUG is independent of WP_DEBUG in WordPress, so it must not
		// feed the WP_DEBUG expression above.
		SCRIPT_DEBUG: site.enableScriptDebug ?? false,
		WP_ENVIRONMENT_TYPE: getWpEnvironmentType( site ),
	};
}
