import fs from 'fs/promises';
import {
	summarizeAiSessionEntries,
	type PiSessionHeader,
} from '@studio/agent/protocol/sessions/summarize-entries';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AiSessionSummary } from '@studio/agent/protocol/sessions/types';

export async function readAiSessionSummaryFromEntries(
	filePath: string,
	fileEntries: Array< SessionEntry | PiSessionHeader >
): Promise< AiSessionSummary | undefined > {
	return summarizeAiSessionEntries( filePath, fileEntries, async () =>
		( await fs.stat( filePath ) ).mtime.toISOString()
	);
}
