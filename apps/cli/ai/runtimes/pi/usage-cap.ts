import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { buildUsageCapErrorMessage, isHttp429ErrorMessage } from '@studio/common/ai/json-events';
import type { AssistantMessageEventStream } from '@earendil-works/pi-ai';

/**
 * On the WordPress.com AI proxy a 429 always means the account's monthly
 * usage cap (see #3102), which retrying can't recover — but pi treats any
 * bare 429 as a transient throttle and retries it with backoff. Rewriting
 * the error with the canonical prefix makes pi classify it as a
 * non-retryable provider limit and gives every surface a stable marker for
 * the cap UI. Only wire this into wpcom-backed providers: on a user-supplied
 * API key a 429 is a genuine rate limit and should keep retrying.
 */
export function withUsageCapErrorRewrite(
	source: AssistantMessageEventStream
): AssistantMessageEventStream {
	const rewritten = createAssistantMessageEventStream();
	void ( async () => {
		for await ( const event of source ) {
			if ( event.type === 'error' && isHttp429ErrorMessage( event.error.errorMessage ) ) {
				event.error.errorMessage = buildUsageCapErrorMessage( event.error.errorMessage ?? '' );
			}
			rewritten.push( event );
		}
		rewritten.end();
	} )();
	return rewritten;
}
