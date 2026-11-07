import { REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { Type } from 'typebox';
import { defineTool, REMOTE_CHANGE } from './define-tool';
import { textResult } from './utils';

export const sendFeedbackTool = defineTool(
	'send_feedback',
	'Sends one feedback report about WordPress Studio to the WordPress Studio team at Automattic, and returns the feedback ID the service assigned. ' +
		'Send only what the user asked to send: show them the exact message first and wait for their OK. ' +
		'Leave out passwords, API keys, tokens and private site content unless the user asks to include them. ' +
		'A line naming the WordPress Studio version and operating system is added for you. ' +
		'Requires the user to be logged in with `studio auth login`. ' +
		'Do not retry a failed send: the report may already have been received, so report the error instead.',
	{
		// STUDIO_FEEDBACK_TYPES, which comes with the Node feedback client.
		type: Type.Enum( [ 'bug', 'request', 'general' ] as const, {
			description:
				'"bug" for something broken, "request" for a feature or improvement, "general" for anything else, including praise.',
		} ),
		message: Type.String( {
			description: 'The feedback, as the user approved it. Plain text.',
		} ),
	},
	async ( args, { host } ) => {
		const accessToken = await host.wpcom.token();
		if ( ! accessToken ) {
			throw new Error(
				`Not logged in to WordPress.com. Ask the user to log in with \`studio auth login\`, or to share feedback at ${ REPORT_ISSUE_URL }.`
			);
		}
		if ( ! args.message.trim() ) {
			throw new Error( 'Submitting feedback needs a message.' );
		}
		if ( ! host.sendFeedback ) {
			throw new Error( `Feedback can't be sent from here. Share it at ${ REPORT_ISSUE_URL }.` );
		}
		try {
			const { feedbackId } = await host.sendFeedback(
				{ type: args.type, message: args.message },
				accessToken
			);
			return textResult( `Feedback sent. Feedback ID: ${ feedbackId }.` );
		} catch ( error ) {
			throw new Error(
				`Failed to send feedback: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet: 'Send the user’s feedback about WordPress Studio to the WordPress Studio team.',
		annotations: REMOTE_CHANGE,
	}
);
