import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { ManagerMessage } from 'cli/lib/types/wordpress-server-ipc';

export type ManagedProcessStatus = 'online' | 'stopped';
export type ManagedProcessLifecycleEvent = 'delete' | 'exit' | 'online' | 'restart' | 'stop';

export type ManagedProcessEvent = {
	event: ManagedProcessLifecycleEvent;
	stderrTail?: string;
};

export type ManagedProcessCallbacks = {
	onEvent: ( process: ManagedProcess, event: ManagedProcessEvent ) => Promise< void > | void;
	onExit: ( process: ManagedProcess ) => Promise< void > | void;
	onMessage: ( process: ManagedProcess, raw: unknown ) => Promise< void > | void;
};

export interface ManagedProcess {
	readonly pmId: number;
	readonly name: string;
	readonly status: ManagedProcessStatus;
	readonly pid?: number;

	start(): Promise< void >;
	stop(): Promise< void >;
	forceStop(): Promise< void > | void;
	sendMessage( message: ManagerMessage ): Promise< void >;
	toProcessDescription(): ProcessDescription;
}
