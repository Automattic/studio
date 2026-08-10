/**
 * Shared types for CLI events between CLI and Studio app.
 *
 * The CLI emits these events via the `_events` command, and Studio
 * subscribes to them to maintain its state without reading config files.
 */
import { z } from 'zod';
import { authTokenSchema } from '@studio/common/lib/auth-token-schema';
import { siteFileAccessSchema } from '@studio/common/lib/site-file-access';
import { siteOperationSchema } from '@studio/common/lib/site-operation';
import { siteRuntimeSchema } from '@studio/common/lib/site-runtime';
import { snapshotSchema } from '@studio/common/types/snapshot';

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
	runtime: siteRuntimeSchema.optional(),
	fileAccess: siteFileAccessSchema.optional(),
	customDomain: z.string().optional(),
	enableHttps: z.boolean().optional(),
	adminUsername: z.string().optional(),
	adminPassword: z.string().optional(),
	adminEmail: z.string().optional(),
	isWpAutoUpdating: z.boolean().optional(),
	enableXdebug: z.boolean().optional(),
	enableDebugLog: z.boolean().optional(),
	enableDebugDisplay: z.boolean().optional(),
	technicalSiteDirectory: z.string().optional(),
	runtimeBlueprintPath: z.string().optional(),
	landingPage: z.string().optional(),
	// In-flight Studio operations holding the site. The UI disables the actions
	// these block, so it stays correct even when the agent started the work.
	operations: z.array( siteOperationSchema ).optional(),
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
	// A lease was claimed or released. Deliberately not `UPDATED`: that one
	// asserts whether the site is running, and consumers treat it as
	// authoritative. A lease change knows nothing about that, and saying so
	// three times per start/stop is what broke the startup performance metric.
	OPERATIONS_CHANGED = 'site-operations-changed',
}

export enum AUTH_EVENTS {
	LOGIN = 'auth-login',
	LOGOUT = 'auth-logout',
}

export enum SNAPSHOT_EVENTS {
	CREATED = 'snapshot-created',
	UPDATED = 'snapshot-updated',
	DELETED = 'snapshot-deleted',
	DELETED_ALL = 'snapshot-deleted-all',
}

export const siteEventSchema = z.object( {
	event: z.enum( SITE_EVENTS ),
	siteId: z.string(),
	site: siteDetailsSchema.optional(),
	running: z.boolean(),
} );

export type SiteEvent = z.infer< typeof siteEventSchema >;

export const snapshotEventSchema = z.union( [
	z.object( {
		event: z.literal( SNAPSHOT_EVENTS.DELETED_ALL ),
	} ),
	z.object( {
		event: z.enum( SNAPSHOT_EVENTS ),
		snapshot: snapshotSchema.optional(),
		snapshotUrl: z.string(),
	} ),
] );

export type SnapshotEvent = z.infer< typeof snapshotEventSchema >;

export const authEventSchema = z.object( {
	event: z.enum( AUTH_EVENTS ),
	token: authTokenSchema.optional(),
} );

export type AuthEvent = z.infer< typeof authEventSchema >;

/**
 * Socket-level schemas for events sent between daemon-client and the _events command.
 */
const siteSocketEventSchema = z.object( {
	event: z.enum( SITE_EVENTS ),
	data: z.object( {
		siteId: z.string(),
	} ),
} );

const snapshotSocketEventSchema = z.union( [
	z.object( {
		event: z.literal( SNAPSHOT_EVENTS.DELETED_ALL ),
	} ),
	z.object( {
		event: z.enum( SNAPSHOT_EVENTS ),
		data: z.object( {
			snapshotUrl: z.string(),
		} ),
	} ),
] );

const authSocketEventSchema = z.object( {
	event: z.enum( AUTH_EVENTS ),
	data: z.object( {
		token: authTokenSchema.optional(),
	} ),
} );

export const socketEventSchema = z.union( [
	siteSocketEventSchema,
	snapshotSocketEventSchema,
	authSocketEventSchema,
] );
export type SocketEvent = z.infer< typeof socketEventSchema >;

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

export const cliAuthEventSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'auth-event' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) )
		.pipe( authEventSchema ),
} );
