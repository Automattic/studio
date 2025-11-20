/**
 * WordPress Server Types for Studio CLI
 *
 * Shared type definitions for WordPress server configuration and messaging
 */
import { Blueprint } from '@wp-playground/blueprints';
import { z } from 'zod';

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
 * Zod schema for ServerConfig validation
 */
export const ServerConfigSchema = z.object( {
	siteId: z.string(),
	sitePath: z.string(),
	port: z.number(),
	phpVersion: z.string().optional(),
	wpVersion: z.string().optional(),
	absoluteUrl: z.string().optional(),
	adminPassword: z.string().optional(),
	siteTitle: z.string().optional(),
	siteLanguage: z.string().optional(),
	isWpAutoUpdating: z.boolean().optional(),
	blueprint: z.any().optional(), // Blueprint type is complex, allow any for now
} );

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

/**
 * Zod schema for Message validation
 */
export const MessageSchema = z.object( {
	id: z.number().optional(),
	type: z.string(),
	data: z
		.object( {
			config: ServerConfigSchema.optional(),
		} )
		.optional(),
	result: z.unknown().optional(),
	error: z.string().optional(),
	errorStack: z.string().optional(),
} );

/**
 * Zod schema for PM2 packet validation
 * Validates the wrapper structure that PM2 uses for inter-process messages
 */
export const PacketSchema = z.object( {
	process: z.object( {
		pm_id: z.number(),
	} ),
	raw: z.union( [
		// Ready message
		z.object( {
			type: z.literal( 'ready' ),
		} ),
		// Activity heartbeat
		z.object( {
			type: z.literal( 'activity' ),
		} ),
		// Response message with id
		z.object( {
			type: z.string(),
			id: z.number(),
			result: z.unknown().optional(),
			error: z.string().optional(),
			errorStack: z.string().optional(),
		} ),
	] ),
} );
