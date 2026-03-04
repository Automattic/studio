import { z } from 'zod';
import { ProcessDescription } from 'cli/lib/types/pm2';
import {
	childMessagePm2Schema,
	managerMessageSchema,
	pm2ProcessEventSchema,
} from './wordpress-server-ipc';

export const processDescriptionSchema = z.object( {
	name: z.string(),
	pmId: z.number(),
	status: z.string(),
	pid: z.number().optional(),
} satisfies Record< keyof ProcessDescription, z.ZodTypeAny > );

const daemonPingRequestSchema = z.object( {
	type: z.literal( 'ping' ),
} );

const daemonStartProcessRequestSchema = z.object( {
	type: z.literal( 'start-process' ),
	processName: z.string(),
	scriptPath: z.string(),
	env: z.record( z.string(), z.string() ).optional(),
	args: z.array( z.string() ).optional(),
} );

const daemonStopProcessRequestSchema = z.object( {
	type: z.literal( 'stop-process' ),
	processName: z.string(),
} );

const daemonListProcessesRequestSchema = z.object( {
	type: z.literal( 'list-processes' ),
} );

const daemonSendMessageToProcessRequestSchema = z.object( {
	type: z.literal( 'send-message-to-process' ),
	processId: z.number(),
	message: managerMessageSchema,
} );

const daemonKillRequestSchema = z.object( {
	type: z.literal( 'kill-daemon' ),
} );

export const daemonRequestWithoutRequestIdSchema = z.discriminatedUnion( 'type', [
	daemonPingRequestSchema,
	daemonStartProcessRequestSchema,
	daemonStopProcessRequestSchema,
	daemonListProcessesRequestSchema,
	daemonSendMessageToProcessRequestSchema,
	daemonKillRequestSchema,
] );

const requestBaseSchema = z.object( { requestId: z.string() } );

export const daemonRequestSchema = z.discriminatedUnion( 'type', [
	requestBaseSchema.extend( daemonPingRequestSchema.shape ),
	requestBaseSchema.extend( daemonStartProcessRequestSchema.shape ),
	requestBaseSchema.extend( daemonStopProcessRequestSchema.shape ),
	requestBaseSchema.extend( daemonListProcessesRequestSchema.shape ),
	requestBaseSchema.extend( daemonSendMessageToProcessRequestSchema.shape ),
	requestBaseSchema.extend( daemonKillRequestSchema.shape ),
] );

export type DaemonRequest = z.infer< typeof daemonRequestSchema >;
export type DaemonRequestWithoutRequestId = z.infer< typeof daemonRequestWithoutRequestIdSchema >;

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

export const daemonProcessEventSchema = z.object( {
	type: z.literal( 'process-event' ),
	payload: pm2ProcessEventSchema,
} );

export const daemonProcessMessageSchema = z.object( {
	type: z.literal( 'process-message' ),
	payload: childMessagePm2Schema,
} );

export const daemonKillEventSchema = z.object( {
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
