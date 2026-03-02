/**
 * Types for VIP Local Development Environment integration.
 *
 * VIP environments are managed by the VIP CLI and use Lando/Docker under the hood.
 * Studio provides a UI layer to detect, display, and manage these environments.
 */

export interface VipComponentConfig {
	mode: 'local' | 'image';
	dir?: string;
	image?: string;
	tag?: string;
}

export interface VipWordPressConfig {
	mode: 'image';
	tag: string;
	ref?: string;
	doNotUpgrade?: boolean;
}

/**
 * VIP environment instance data as stored in instance_data.json.
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
 */
export interface VipEnvironment {
	slug: string;
	title: string;
	running: boolean;
	phpVersion: string;
	wordpressVersion: string;
	multisite: boolean | 'subdomain' | 'subdirectory';
	elasticsearch: boolean;
	phpmyadmin: boolean;
	xdebug: boolean;
	mailpit: boolean;
	path: string;
	urls: string[];
	appCodePath?: string;
	muPluginsPath?: string;
	autologinKey?: string;
	adminPassword?: string;
}

/**
 * Result of checking VIP CLI availability.
 */
export interface VipCliStatus {
	available: boolean;
	version?: string;
	path?: string;
	error?: string;
}

export interface VipStartOptions {
	skipRebuild?: boolean;
	skipWpVersionCheck?: boolean;
}

export interface VipCreateOptions {
	slug: string;
	title?: string;
	phpVersion?: string;
	multisite?: boolean | 'subdomain' | 'subdirectory';
	appCodePath?: string;
	muPluginsPath?: string;
	elasticsearch?: boolean;
	phpmyadmin?: boolean;
	xdebug?: boolean;
	mailpit?: boolean;
	photon?: boolean;
	cron?: boolean;
	mediaRedirectDomain?: string;
}

export interface VipCommandResult {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

/** @deprecated Use VipCommandResult */
export type VipCliCommandResult = VipCommandResult;
