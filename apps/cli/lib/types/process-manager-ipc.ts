import { z } from 'zod';
import { childMessagePm2Schema, managerMessageSchema } from 'cli/lib/types/wordpress-server-ipc';

// Zod schema for process descriptions
export const processDescriptionSchema = z.object( {
	name: z.string(),
	pmId: z.number(),
	status: z.string(),
	pid: z.number().optional(),
} );
export type ProcessDescription = z.infer< typeof processDescriptionSchema >;

// Zod schemas for requests to process manager daemon
const daemonRequestPingSchema = z.object( {
	type: z.literal( 'ping' ),
} );

const daemonRequestStartProcessSchema = z.object( {
	type: z.literal( 'start-process' ),
	processName: z.string(),
	scriptPath: z.string(),
	env: z.record( z.string(), z.string() ).optional(),
	args: z.array( z.string() ).optional(),
} );

const daemonRequestStopProcessSchema = z.object( {
	type: z.literal( 'stop-process' ),
	processName: z.string(),
} );

const daemonRequestListProcessesSchema = z.object( {
	type: z.literal( 'list-processes' ),
} );

const daemonRequestSendMessageToProcessSchema = z.object( {
	type: z.literal( 'send-message-to-process' ),
	processId: z.number(),
	message: managerMessageSchema,
} );

const daemonRequestKillSchema = z.object( {
	type: z.literal( 'kill-daemon' ),
} );

export const daemonRequestSchema = z.discriminatedUnion( 'type', [
	daemonRequestPingSchema,
	daemonRequestStartProcessSchema,
	daemonRequestStopProcessSchema,
	daemonRequestListProcessesSchema,
	daemonRequestSendMessageToProcessSchema,
	daemonRequestKillSchema,
] );
export type DaemonRequest = z.infer< typeof daemonRequestSchema >;

// Zod schemas for responses from process manager daemon
const daemonResponseResultSchema = z.object( {
	type: z.literal( 'result' ),
	payload: z.unknown(),
} );
export type DaemonResponseResult = z.infer< typeof daemonResponseResultSchema >;

const daemonResponseErrorSchema = z.object( {
	type: z.literal( 'error' ),
	error: z.object( {
		message: z.string(),
		stack: z.string().optional(),
	} ),
} );

export const daemonResponseSchema = z.discriminatedUnion( 'type', [
	daemonResponseResultSchema,
	daemonResponseErrorSchema,
] );
export type DaemonResponse = z.infer< typeof daemonResponseSchema >;

// Zod schemas for process manager events (messages, online, exit, stop, restart)
export const pm2ProcessEventSchema = z.object( {
	process: z.object( {
		name: z.string(),
		pm_id: z.number().optional(),
	} ),
	event: z.string(),
} );

const daemonProcessEventSchema = z.object( {
	type: z.literal( 'process-event' ),
	payload: pm2ProcessEventSchema,
} );

const daemonProcessMessageSchema = z.object( {
	type: z.literal( 'process-message' ),
	payload: childMessagePm2Schema,
} );

const daemonKillEventSchema = z.object( {
	type: z.literal( 'daemon-kill' ),
	payload: z.object( {
		reason: z.string().optional(),
	} ),
} );

export const daemonEventSchema = z.discriminatedUnion( 'type', [
	daemonProcessEventSchema,
	daemonProcessMessageSchema,
	daemonKillEventSchema,
] );
export type DaemonEvent = z.infer< typeof daemonEventSchema >;
