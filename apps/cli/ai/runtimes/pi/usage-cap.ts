import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { buildUsageCapErrorMessage, isCostCapErrorMessage } from '@studio/common/ai/json-events';
import type { AssistantMessageEventStream } from '@earendil-works/pi-ai';

/**
 * The WordPress.com AI proxy reports the account's monthly cost cap as a 429
 * carrying `cost_cap_exceeded` (see #3102). Retrying can't recover it, but pi
 * treats a bare 429 as a transient throttle and retries with backoff, so the
 * error is rewritten with the canonical prefix — that makes pi classify it as
 * a non-retryable provider limit and gives every surface a stable marker for
 * the cap UI.
 *
 * The code, not the status, is the gate: hosted upstreams behind the proxy
 * return their own 429s for rate limits, and those *should* keep retrying.
 *
 * The proxy's out-of-credits refusal (402 `studio_out_of_credits`, STU-2236)
 * deliberately passes through unrewritten: pi only retries errors matching
 * its transient patterns (429/5xx/transport), which the 402 message never
 * does, and the `studio_out_of_credits` token in the message is the stable
 * marker the UI surfaces key on (see `isOutOfCreditsError`). The tests pin
 * both properties.
 */
export function withUsageCapErrorRewrite(
	source: AssistantMessageEventStream
): AssistantMessageEventStream {
	const rewritten = createAssistantMessageEventStream();
	void ( async () => {
		for await ( const event of source ) {
			if ( event.type === 'error' && isCostCapErrorMessage( event.error.errorMessage ) ) {
				event.error.errorMessage = buildUsageCapErrorMessage( event.error.errorMessage ?? '' );
			}
			rewritten.push( event );
		}
		rewritten.end();
	} )();
	return rewritten;
}
