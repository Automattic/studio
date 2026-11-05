import { REPORT_ISSUE_URL } from '@studio/common/lib/docs-links';
import { sendStudioFeedback, STUDIO_FEEDBACK_TYPES } from '@studio/common/lib/feedback';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { Type } from 'typebox';
import { defineTool, REMOTE_CHANGE } from './define-tool';
import { textResult } from './utils';

export const sendFeedbackTool = defineTool(
	'send_feedback',
	'Sends feedback about WordPress Studio to the WordPress Studio team at Automattic. ' +
		'Only send feedback the user asked to send. When a WordPress Studio tool fails in a way you cannot work around, or the user is frustrated with WordPress Studio, you may offer once to send feedback; ' +
		'send it only if they agree. Before sending, show the user the exact message and wait for their OK. ' +
		'Write it in plain language: what the user was trying to do, what happened, what they expected, and the WordPress Studio tool and error message when there is one. ' +
		'Leave out passwords, API keys, tokens and private site content unless the user asks to include them. ' +
		'The message is sent with a line naming the WordPress Studio version and operating system. Requires the user to be logged in with `studio auth login`. ' +
		'Submitting returns a feedback ID.',
	{
		type: Type.Enum( STUDIO_FEEDBACK_TYPES, {
			description:
				'"bug" for something broken, "request" for a feature or improvement, "general" for anything else, including praise.',
		} ),
		message: Type.String( {
			description: 'The feedback, as the user approved it. Plain text.',
		} ),
	},
	async ( args, context ) => {
		const token = await readAuthToken();
		if ( ! token?.accessToken ) {
			throw new Error(
				`Not logged in to WordPress.com. Ask the user to log in with \`studio auth login\`, or to share feedback at ${ REPORT_ISSUE_URL }.`
			);
		}
		if ( ! args.message.trim() ) {
			throw new Error( 'Submitting feedback needs a message.' );
		}
		try {
			const { feedbackId } = await sendStudioFeedback(
				{ type: args.type, message: args.message },
				{ accessToken: token.accessToken, userAgent: context.host.userAgent }
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
