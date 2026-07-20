import { z } from 'zod';

export const FEEDBACK_CATEGORIES = [ 'general', 'bug', 'feature', 'other' ] as const;
export type FeedbackCategory = ( typeof FEEDBACK_CATEGORIES )[ number ];

export const MAX_FEEDBACK_MESSAGE_LENGTH = 5000;

// Recent-log tail attached to a submission. Bounded so large multi-MB log files
// don't inflate the payload; the tail keeps the most relevant (latest) lines.
export const LOG_TAIL_BYTES = 256 * 1024;

export const FEEDBACK_API_PATH = '/studio-app/feedback';
export const FEEDBACK_API_URL = `https://public-api.wordpress.com/wpcom/v2${ FEEDBACK_API_PATH }`;

// Renderer → main input. Identity is deliberately absent: it is resolved
// authoritatively in the main process so the flow works even from the crash
// screen, where the auth/Redux providers are unmounted.
export const feedbackSubmissionSchema = z.object( {
	message: z.string().trim().min( 1 ).max( MAX_FEEDBACK_MESSAGE_LENGTH ),
	email: z.string().email().optional(),
	includeLogs: z.boolean().default( true ),
	category: z.enum( FEEDBACK_CATEGORIES ).default( 'general' ),
} );

export type FeedbackSubmission = z.infer< typeof feedbackSubmissionSchema >;

export type FeedbackErrorCode = 'offline' | 'validation' | 'network' | 'server';
export type FeedbackResult = { success: true } | { success: false; error: FeedbackErrorCode };

export type FeedbackIdentity =
	| { type: 'wpcom'; wpcomUserId: number; email: string; displayName: string }
	| { type: 'anonymous'; anonymousId: string; contactEmail?: string };

// Main → backend payload. A superset of the submission, assembled in the handler.
export interface FeedbackWirePayload {
	message: string;
	category: FeedbackCategory;
	appVersion: string;
	platform: string;
	electronVersion: string;
	osVersion?: string;
	identity: FeedbackIdentity;
	logs?: string;
}
