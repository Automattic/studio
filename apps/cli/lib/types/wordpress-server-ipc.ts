import { z } from 'zod';

// Zod schemas for validating IPC messages from wordpress-server-manager
const serverConfig = z.object( {
	siteId: z.string(),
	sitePath: z.string(),
	port: z.number(),
	phpVersion: z.string().optional(),
	wpVersion: z.string().optional(),
	absoluteUrl: z.string().optional(),
	adminUsername: z.string().optional(),
	adminPassword: z.string().optional(),
	adminEmail: z.string().optional(),
	siteTitle: z.string().optional(),
	siteLanguage: z.string().optional(),
	isWpAutoUpdating: z.boolean().optional(),
	enableXdebug: z.boolean().optional(),
	enableDebugLog: z.boolean().optional(),
	enableDebugDisplay: z.boolean().optional(),
	blueprint: z
		.object( {
			contents: z.any(), // Blueprint type is complex, allow any for now
			uri: z.string(),
		} )
		.optional(),
} );

export type ServerConfig = z.infer< typeof serverConfig >;

const managerMessageAbort = z.object( {
	topic: z.literal( 'abort' ),
	data: z.object( {} ),
} );

const managerMessageStartServer = z.object( {
	topic: z.literal( 'start-server' ),
	data: z.object( {
		config: serverConfig,
	} ),
} );

const managerMessageRunBlueprint = z.object( {
	topic: z.literal( 'run-blueprint' ),
	data: z.object( {
		config: serverConfig,
	} ),
} );

const managerMessageStopServer = z.object( {
	topic: z.literal( 'stop-server' ),
	data: z.object( {} ),
} );

const managerMessageWpCliCommand = z.object( {
	topic: z.literal( 'wp-cli-command' ),
	data: z.object( {
		args: z.array( z.string() ),
	} ),
} );

const _managerMessagePayloadSchema = z.discriminatedUnion( 'topic', [
	managerMessageAbort,
	managerMessageStartServer,
	managerMessageRunBlueprint,
	managerMessageStopServer,
	managerMessageWpCliCommand,
] );
export type ManagerMessagePayload = z.infer< typeof _managerMessagePayloadSchema >;

const managerMessageBase = z.object( { messageId: z.string() } );
export const managerMessageSchema = z.discriminatedUnion( 'topic', [
	managerMessageBase.extend( managerMessageAbort.shape ),
	managerMessageBase.extend( managerMessageStartServer.shape ),
	managerMessageBase.extend( managerMessageRunBlueprint.shape ),
	managerMessageBase.extend( managerMessageStopServer.shape ),
	managerMessageBase.extend( managerMessageWpCliCommand.shape ),
] );
export type ManagerMessage = z.infer< typeof managerMessageSchema >;

// Zod schemas for validating IPC messages from wordpress-server-child
const childMessageReady = z.object( {
	topic: z.literal( 'ready' ),
} );

const childMessageActivity = z.object( {
	topic: z.literal( 'activity' ),
} );

const childMessageResult = z.object( {
	originalMessageId: z.string(),
	topic: z.literal( 'result' ),
	result: z.unknown(),
} );

const childMessageError = z.object( {
	originalMessageId: z.string(),
	topic: z.literal( 'error' ),
	errorMessage: z.string(),
	errorStack: z.string().optional(),
	cliArgs: z.record( z.string(), z.unknown() ).optional(),
} );

const childMessageConsole = z.object( {
	topic: z.literal( 'console-message' ),
	message: z.string(),
} );

const childMessageSiteCreated = z.object( {
	topic: z.literal( 'site-created' ),
	data: z.object( {
		siteId: z.string(),
	} ),
} );

const childMessageSiteUpdated = z.object( {
	topic: z.literal( 'site-updated' ),
	data: z.object( {
		siteId: z.string(),
	} ),
} );

const childMessageSiteDeleted = z.object( {
	topic: z.literal( 'site-deleted' ),
	data: z.object( {
		siteId: z.string(),
	} ),
} );

const childMessageSiteStarted = z.object( {
	topic: z.literal( 'site-started' ),
	data: z.object( {
		siteId: z.string(),
		url: z.string(),
	} ),
} );

const childMessageSiteStopped = z.object( {
	topic: z.literal( 'site-stopped' ),
	data: z.object( {
		siteId: z.string(),
	} ),
} );

const childMessageRaw = z.discriminatedUnion( 'topic', [
	childMessageReady,
	childMessageActivity,
	childMessageResult,
	childMessageError,
	childMessageConsole,
	childMessageSiteCreated,
	childMessageSiteUpdated,
	childMessageSiteDeleted,
	childMessageSiteStarted,
	childMessageSiteStopped,
] );
export type ChildMessageRaw = z.infer< typeof childMessageRaw >;
export const childMessagePm2Schema = z.object( {
	process: z.object( {
		name: z.string(),
		pm_id: z.number(),
	} ),
	raw: childMessageRaw,
} );
