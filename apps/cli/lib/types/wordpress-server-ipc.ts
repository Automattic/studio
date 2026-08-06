import { siteFileAccessSchema } from '@studio/common/lib/site-file-access';
import { wpEnvironmentTypeSchema } from '@studio/common/lib/wp-environment-type';
import { z } from 'zod';
import type { WordPressInstallMode } from '@wp-playground/wordpress';

// Zod schemas for validating IPC messages from wordpress-server-manager
const mountSchema = z.object( {
	hostPath: z.string(),
	vfsPath: z.string(),
} );

const wordpressInstallModeSchema: z.ZodType< WordPressInstallMode > = z.enum( [
	'download-and-install',
	'install-from-existing-files',
	'install-from-existing-files-if-needed',
	'do-not-attempt-installing',
] );

export const serverConfigSchema = z.object( {
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
	fileAccess: siteFileAccessSchema.optional(),
	enableXdebug: z.boolean().optional(),
	enableDebugLog: z.boolean().optional(),
	enableDebugDisplay: z.boolean().optional(),
	enableScriptDebug: z.boolean().optional(),
	environmentType: wpEnvironmentTypeSchema.optional(),
	blueprint: z
		.object( {
			contents: z.any(), // Blueprint type is complex, allow any for now
			uri: z.string(),
		} )
		.optional(),
	mounts: z.array( mountSchema ).optional(),
	mountsBeforeInstall: z.array( mountSchema ).optional(),
	wordpressInstallMode: wordpressInstallModeSchema.optional(),
	skipSqliteSetup: z.boolean().optional(),
	useExactMountLayout: z.boolean().optional(),
	autoPrependFile: z.string().optional(),
	openBasedirAllowList: z.array( z.string() ).optional(),
} );

export type ServerConfig = z.infer< typeof serverConfigSchema >;

const managerMessageAbort = z.object( {
	topic: z.literal( 'abort' ),
	data: z.object( {} ),
} );

const managerMessageStartServer = z.object( {
	topic: z.literal( 'start-server' ),
	data: z.object( {
		config: serverConfigSchema,
	} ),
} );

const managerMessageRunBlueprint = z.object( {
	topic: z.literal( 'run-blueprint' ),
	data: z.object( {
		config: serverConfigSchema,
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

// Zod schemas for validating IPC messages from a server child process
const childMessageReady = z.object( {
	topic: z.literal( 'ready' ),
} );

const childMessageActivity = z.object( {
	topic: z.literal( 'activity' ),
} );

const childMessageServerProcessStarted = z.object( {
	topic: z.literal( 'server-process-started' ),
	data: z.object( {
		pid: z.number(),
	} ),
} );

const childMessageResult = z.object( {
	originalMessageId: z.string(),
	topic: z.literal( 'result' ),
	// `result` is `optional` so handlers that return `void` (e.g. `start-server`) survive
	// IPC serialization — Node's default JSON IPC drops `undefined` values, leaving the key
	// absent on the receiving side. Zod 4's `z.unknown()` rejects an absent key.
	result: z.unknown().optional(),
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
	childMessageServerProcessStarted,
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
export const childMessageFromProcessManagerSchema = z.object( {
	process: z.object( {
		name: z.string(),
		pm_id: z.number(),
	} ),
	raw: childMessageRaw,
} );
