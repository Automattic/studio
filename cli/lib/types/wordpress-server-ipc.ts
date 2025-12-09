import { z } from 'zod';

// Zod schemas for validating IPC messages from wordpress-server-manager
const serverConfig = z.object( {
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

export type ServerConfig = z.infer< typeof serverConfig >;

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
} );

const managerMessageWpCliCommand = z.object( {
	topic: z.literal( 'wp-cli-command' ),
	data: z.object( {
		args: z.array( z.string() ),
	} ),
} );

const _managerMessagePayloadSchema = z.discriminatedUnion( 'topic', [
	managerMessageStartServer,
	managerMessageRunBlueprint,
	managerMessageStopServer,
	managerMessageWpCliCommand,
] );
export type ManagerMessagePayload = z.infer< typeof _managerMessagePayloadSchema >;

const managerMessageBase = z.object( { messageId: z.number() } );
export const managerMessageSchema = z.discriminatedUnion( 'topic', [
	managerMessageBase.merge( managerMessageStartServer ),
	managerMessageBase.merge( managerMessageRunBlueprint ),
	managerMessageBase.merge( managerMessageStopServer ),
	managerMessageBase.merge( managerMessageWpCliCommand ),
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
	originalMessageId: z.number(),
	topic: z.literal( 'result' ),
	result: z.unknown(),
} );

const childMessageError = z.object( {
	originalMessageId: z.number(),
	topic: z.literal( 'error' ),
	errorMessage: z.string(),
	errorStack: z.string().optional(),
} );

const childMessageRaw = z.discriminatedUnion( 'topic', [
	childMessageReady,
	childMessageActivity,
	childMessageResult,
	childMessageError,
] );
export type ChildMessageRaw = z.infer< typeof childMessageRaw >;
export const childMessagePm2Schema = z.object( {
	process: z.object( {
		pm_id: z.number(),
	} ),
	raw: childMessageRaw,
} );
