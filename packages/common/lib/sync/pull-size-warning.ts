import path from 'node:path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { calculateDirectorySizeForArchive } from '@studio/common/lib/fs-utils';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '@studio/common/lib/sync/constants';

/**
 * Whether a just-pulled site looks too big to push back.
 *
 * The Jetpack pull can ask before downloading, because there is a single
 * backup archive whose `Content-Length` it can read. Reprint streams the site
 * in pieces with no such total, so the only cheap answer is to measure what
 * landed on disk and tell the user afterwards.
 *
 * That tally is deliberately not the number the push limit applies to: push
 * uploads a gzipped archive, so this over-reports — a lot for a text-heavy
 * site, barely at all for a media-heavy one whose uploads are already
 * compressed. It is left uncorrected on purpose. Over-reporting costs a false
 * alarm; under-reporting would stay quiet and let the user hit the ceiling at
 * push time, which is the thing the warning exists to prevent. The wording it
 * drives says "may", for the same reason.
 *
 * Written to be deleted: when push moves to Reprint there is no single upload
 * to bind a ceiling to, and this check goes away rather than getting sharper.
 */
export async function isSiteOverPushSizeLimit( sitePath: string ): Promise< boolean > {
	const deployIgnore = await createDeployIgnoreFilter( sitePath );
	const wpContentSize = await calculateDirectorySizeForArchive(
		path.join( sitePath, 'wp-content' ),
		deployIgnore,
		'wp-content'
	);

	return wpContentSize > SYNC_PUSH_SIZE_LIMIT_BYTES;
}
