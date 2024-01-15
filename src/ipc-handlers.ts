import { type IpcMainInvokeEvent } from 'electron';

// IPC functions must accept an `event` as the first argument.
/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "event" }] */

export async function ping( event: IpcMainInvokeEvent, message: string ): Promise< string > {
	return message;
}
