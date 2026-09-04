import { SITE_RUNTIME_PLAYGROUND, siteRuntimeSchema } from '@studio/common/lib/site-runtime';
import { z } from 'zod';
import {
	childMessageFromProcessManagerSchema,
	managerMessageSchema,
} from 'cli/lib/types/wordpress-server-ipc';

// Zod schema for process descriptions
const processDescriptionSchemaBase = z.object( {
	name: z.string(),
	pmId: z.number(),
	runtime: siteRuntimeSchema.default( SITE_RUNTIME_PLAYGROUND ),
} );
const processDescriptionSchemaRunning = processDescriptionSchemaBase.extend( {
	status: z.literal( 'online' ),
	pid: z.number(),
} );
const processDescriptionSchemaStopped = processDescriptionSchemaBase.extend( {
	status: z.literal( 'stopped' ),
} );
export const processDescriptionSchema = z.discriminatedUnion( 'status', [
	processDescriptionSchemaRunning,
	processDescriptionSchemaStopped,
] );
export type ProcessDescription = z.infer< typeof processDescriptionSchema >;

// Zod schemas for requests to process manager daemon
const daemonRequestPingSchema = z.object( {
	type: z.literal( 'ping' ),
} );

const daemonRequestStartProcessSchema = z.object( {
	type: z.literal( 'start-process' ),
	processName: z.string(),
	scriptPath: z.string(),
	env: z.record( z.string(), z.union( [ z.string(), z.undefined() ] ) ).optional(),
	args: z.array( z.string() ).optional(),
	runtime: siteRuntimeSchema.optional(),
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
export const processEventSchema = z.object( {
	process: z.object( {
		name: z.string(),
		pm_id: z.number(),
	} ),
	event: z.union( [
		z.literal( 'delete' ),
		z.literal( 'exit' ),
		z.literal( 'online' ),
		z.literal( 'restart' ),
		z.literal( 'stop' ),
	] ),
	// Tail of the child's stderr captured during this invocation. Only populated on `exit`
	// events; undefined for any other event.
	stderrTail: z.string().optional(),
	// How the child ended. Only populated on `exit` events: `exitCode` when it exited on its
	// own, `signal` when it was killed. Both are absent when the spawn itself failed.
	exitCode: z.number().optional(),
	signal: z.string().optional(),
} );

const daemonProcessEventSchema = z.object( {
	type: z.literal( 'process-event' ),
	payload: processEventSchema,
} );

const daemonProcessMessageSchema = z.object( {
	type: z.literal( 'process-message' ),
	payload: childMessageFromProcessManagerSchema,
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
