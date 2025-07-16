/**
 * Types and interfaces for child process communication with WordPress providers
 * These interfaces define what functionality child processes need from providers
 */

import type { PHPRunOptions } from '@php-wasm/universal';

// WP-CLI Child Process Types
export interface WpCliChildProcessProvider {
	executeWPCli(
		projectPath: string,
		args: string[],
		options?: { phpVersion?: string }
	): Promise< {
		stdout: string;
		stderr: string;
		exitCode: number;
	} >;
}

// Site Server Child Process Types
export interface SiteServerChildProcessProvider {
	startServer( options: SiteServerOptions ): Promise< SiteServerInstance >;
}

// For now, SiteServerOptions should match the provider-specific options
// In this case, it matches WPNowOptions since we're passing those directly
export interface SiteServerOptions {
	// Provider-agnostic options that all providers should support
	path?: string;
	port?: number;
	adminPassword?: string;
	siteTitle?: string;
	phpVersion?: string;
	wpVersion?: string;
	wordPressVersion?: string;
	isWpAutoUpdating?: boolean;
	absoluteUrl?: string;
	siteLanguage?: string;
	documentRoot?: string;
	projectPath?: string;
	wpContentPath?: string;
	// Allow additional provider-specific options
	[ key: string ]: unknown;
}

export interface SiteServerInstance {
	php: {
		documentRoot: string;
		run( request: PHPRunOptions ): Promise< { text: string } >;
	};
	stopServer(): Promise< void >;
}

// Common child process message types
export type WpCliMessageName = 'execute';
export type SiteServerMessageName = 'start-server' | 'stop-server' | 'run-php';

export interface ChildProcessMessage< T = unknown > {
	message: string;
	messageId: number;
	data: T;
}

export interface ChildProcessResponse< T = unknown > {
	message: string;
	messageId: number;
	data?: T;
	error?: string | Error;
}
