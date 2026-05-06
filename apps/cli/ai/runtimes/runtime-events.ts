// Streaming events the runtime yields. Pi's `AgentEvent` covers the run
// lifecycle (agent_start/end, turn_end, message_*, tool_*); compaction
// events match the shape pi's `AgentSession` emits so consumers stay
// aligned with what the broader pi ecosystem produces.

import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';

export type CompactionStartEvent = Extract< AgentSessionEvent, { type: 'compaction_start' } >;
export type CompactionEndEvent = Extract< AgentSessionEvent, { type: 'compaction_end' } >;
export type CompactionReason = CompactionStartEvent[ 'reason' ];

export type AgentRuntimeEvent = AgentEvent | CompactionStartEvent | CompactionEndEvent;
