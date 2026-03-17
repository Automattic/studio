/**
 * Shared types for CLI events between CLI and Studio app.
 *
 * The CLI emits these events via the `_events` command, and Studio
 * subscribes to them to maintain its state without reading config files.
 */
import { snapshotSchema } from '@studio/common/types/snapshot';
import { z } from 'zod';

/**
 * Site data included in events. This is the data Studio needs to display sites.
 */
export const siteDetailsSchema = z.object( {
	id: z.string(),
	name: z.string(),
	path: z.string(),
	port: z.number(),
	url: z.string(),
	phpVersion: z.string(),
	customDomain: z.string().optional(),
	enableHttps: z.boolean().optional(),
	adminUsername: z.string().optional(),
	adminPassword: z.string().optional(),
	adminEmail: z.string().optional(),
	isWpAutoUpdating: z.boolean().optional(),
	autoStart: z.boolean().optional(),
	enableXdebug: z.boolean().optional(),
	enableDebugLog: z.boolean().optional(),
	enableDebugDisplay: z.boolean().optional(),
} );

export type SiteDetails = z.infer< typeof siteDetailsSchema >;

export const siteListItemSchema = siteDetailsSchema.extend( {
	running: z.boolean(),
} );

export type SiteListItem = z.infer< typeof siteListItemSchema >;

export const siteListSchema = z.array( siteListItemSchema );

export enum SITE_EVENTS {
	CREATED = 'site-created',
	UPDATED = 'site-updated',
	DELETED = 'site-deleted',
}

export enum SNAPSHOT_EVENTS {
	CREATED = 'snapshot-created',
	UPDATED = 'snapshot-updated',
	DELETED = 'snapshot-deleted',
}

export const siteEventSchema = z.object( {
	event: z.enum( SITE_EVENTS ),
	siteId: z.string(),
	site: siteDetailsSchema.optional(),
	running: z.boolean(),
} );

export type SiteEvent = z.infer< typeof siteEventSchema >;

export const snapshotEventSchema = z.object( {
	event: z.enum( SNAPSHOT_EVENTS ),
	snapshot: snapshotSchema.optional(),
	snapshotUrl: z.string(),
} );

export type SnapshotEvent = z.infer< typeof snapshotEventSchema >;

/**
 * Socket-level schemas for events sent between daemon-client and the _events command.
 */
export const siteSocketEventSchema = z.object( {
	event: z.string(),
	data: z.object( {
		siteId: z.string(),
	} ),
} );

export const snapshotSocketEventSchema = z.object( {
	event: z.enum( SNAPSHOT_EVENTS ),
	data: z.object( {
		snapshotUrl: z.string(),
	} ),
} );

/**
 * CLI stdout key-value pair schemas for events parsed by Studio's cli-events-subscriber.
 */
export const cliSiteEventSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'site-event' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) )
		.pipe( siteEventSchema ),
} );

export const cliSnapshotEventSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'snapshot-event' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) )
		.pipe( snapshotEventSchema ),
} );
