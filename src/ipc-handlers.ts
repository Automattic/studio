import { type IpcMainInvokeEvent } from 'electron';

export async function ping( event: IpcMainInvokeEvent, message: string ): Promise< string > {
	return message;
}
