/**
 * Types for VIP Local Development Environment integration.
 *
 * VIP environments are managed by the VIP CLI and use Lando/Docker under the hood.
 * Studio provides a UI layer to detect, display, and manage these environments.
 */

/**
 * Configuration for WordPress component (core, mu-plugins, app-code).
 * Mirrors VIP CLI's ComponentConfig.
 */
export interface VipComponentConfig {
	mode: 'local' | 'image';
	dir?: string;
	image?: string;
	tag?: string;
}

/**
 * WordPress-specific configuration.
 */
export interface VipWordPressConfig {
	mode: 'image';
	tag: string;
	ref?: string;
	doNotUpgrade?: boolean;
}

/**
 * VIP environment instance data as stored in instance_data.json.
 * This is the schema used by VIP CLI.
 */
export interface VipInstanceData {
	siteSlug: string;
	wpTitle: string;
	multisite: boolean | 'subdomain' | 'subdirectory';
	wordpress: VipWordPressConfig;
	muPlugins: VipComponentConfig;
	appCode: VipComponentConfig;
	mediaRedirectDomain: string;
	php: string;
	elasticsearch?: boolean | string;
	phpmyadmin: boolean;
	xdebug: boolean;
	xdebugConfig?: string;
	mailpit: boolean;
	photon: boolean;
	cron: boolean;
	pullAfter?: number;
	autologinKey?: string;
	adminPassword?: string;
	version?: string;
	overrides?: string;
}

/**
 * VIP environment as represented in Studio.
 * This is a simplified view of VipInstanceData for UI purposes.
 */
export interface VipEnvironment {
	/** Environment slug (unique identifier) */
	slug: string;
	/** WordPress site title */
	title: string;
	/** Whether the environment is currently running */
	running: boolean;
	/** PHP version (e.g., "8.2") */
	phpVersion: string;
	/** WordPress version/tag (e.g., "6.7" or "trunk") */
	wordpressVersion: string;
	/** Whether this is a multisite installation */
	multisite: boolean | 'subdomain' | 'subdirectory';
	/** Whether Elasticsearch is enabled */
	elasticsearch: boolean;
	/** Whether phpMyAdmin is enabled */
	phpmyadmin: boolean;
	/** Whether XDebug is enabled */
	xdebug: boolean;
	/** Whether Mailpit is enabled */
	mailpit: boolean;
	/** Path to the environment directory */
	path: string;
	/** Site URLs (when running) */
	urls: string[];
	/** App code directory (if using local mode) */
	appCodePath?: string;
	/** MU plugins directory (if using local mode) */
	muPluginsPath?: string;
	/** Auto-login key for quick access */
	autologinKey?: string;
	/** Admin password */
	adminPassword?: string;
}

/**
 * Result of checking VIP CLI availability.
 */
export interface VipCliStatus {
	/** Whether VIP CLI is installed and accessible */
	available: boolean;
	/** VIP CLI version string (if available) */
	version?: string;
	/** Path to the VIP CLI binary */
	path?: string;
	/** Error message if not available */
	error?: string;
}

/**
 * Options for starting a VIP environment.
 */
export interface VipStartOptions {
	/** Skip rebuilding containers */
	skipRebuild?: boolean;
	/** Skip WordPress version check */
	skipWpVersionCheck?: boolean;
}

/**
 * Result from VIP CLI command execution.
 */
export interface VipCommandResult {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number | null;
}
