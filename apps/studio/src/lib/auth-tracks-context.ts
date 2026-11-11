import { createAuthAttempt, createAuthAttemptStore } from '@studio/common/lib/auth-tracks';
import type { AuthAnalytics } from '@studio/common/lib/auth-tracks';
import type {
	TracksAuthSource,
	TracksAuthAccountType,
} from '@studio/common/lib/record-tracks-event';

const attempts = createAuthAttemptStore();

export function setPendingAuthContext(
	source: TracksAuthSource,
	accountType: TracksAuthAccountType,
	analytics?: AuthAnalytics
) {
	const attempt = createAuthAttempt( source, accountType === 'new', analytics );
	attempts.add( attempt );
	return attempt;
}

export const takePendingAuthContext = attempts.take;
export const __resetPendingAuthContext = attempts.clear;
