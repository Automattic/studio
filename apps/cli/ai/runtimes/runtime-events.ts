// Streaming events the runtime yields. Pi's `AgentSessionEvent` already
// unions the agent lifecycle (agent_start/end, turn_end, message_*,
// tool_*) with compaction + auto-retry + queue-update, so we adopt it
// wholesale. Studio doesn't emit auto_retry_* or queue_update today —
// consumers just ignore those variants.

import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';

export type AgentRuntimeEvent = AgentSessionEvent;

export type CompactionStartEvent = Extract< AgentSessionEvent, { type: 'compaction_start' } >;
export type CompactionEndEvent = Extract< AgentSessionEvent, { type: 'compaction_end' } >;
export type CompactionReason = CompactionStartEvent[ 'reason' ];
