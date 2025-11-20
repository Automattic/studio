/**
 * WordPress Server Types for Studio CLI
 *
 * Shared type definitions for WordPress server configuration and messaging
 */
import { Blueprint } from '@wp-playground/blueprints';

/**
 * Configuration for a WordPress server instance
 */
export interface ServerConfig {
	siteId: string;
	sitePath: string;
	port: number;
	phpVersion?: string;
	wpVersion?: string;
	absoluteUrl?: string;
	adminPassword?: string;
	siteTitle?: string;
	siteLanguage?: string;
	isWpAutoUpdating?: boolean;
	blueprint?: Blueprint;
}

/**
 * Message format for inter-process communication between PM2 processes
 */
export interface Message {
	id?: number;
	type: string;
	data?: {
		config?: ServerConfig;
	};
	result?: unknown;
	error?: string;
	errorStack?: string;
}
