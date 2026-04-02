import crypto from 'crypto';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import {
	startTaskAgent as startAgent,
	sendTaskMessage as sendMessage,
	interruptTask as interrupt,
	respondToPermissionRequest as respondPermission,
} from './agent-manager';
import type { ImageAttachment, PermissionResponse, TaskMetadata, TaskStatus } from '../types';
import type { IpcMainInvokeEvent } from 'electron';

export async function createTask(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< TaskMetadata > {
	const now = Date.now();
	const task: TaskMetadata = {
		id: crypto.randomUUID(),
		siteId,
		title: 'New task',
		status: 'waiting',
		archived: false,
		createdAt: now,
		updatedAt: now,
	};

	try {
		await lockAppdata();
		const userData = await loadUserData();
		const tasks = userData.tasks ?? [];
		tasks.push( task );
		await saveUserData( { ...userData, tasks } );
	} finally {
		await unlockAppdata();
	}

	await sendIpcEventToRenderer( 'task-updated', task );
	return task;
}

export async function getAllTasks( _event: IpcMainInvokeEvent ): Promise< TaskMetadata[] > {
	const userData = await loadUserData();
	return userData.tasks ?? [];
}

export async function updateTask(
	_event: IpcMainInvokeEvent,
	taskId: string,
	updates: Partial< Pick< TaskMetadata, 'title' | 'status' | 'archived' | 'sessionId' > >
): Promise< TaskMetadata | null > {
	let updated: TaskMetadata | null = null;

	try {
		await lockAppdata();
		const userData = await loadUserData();
		const tasks = userData.tasks ?? [];
		const index = tasks.findIndex( ( t ) => t.id === taskId );
		if ( index === -1 ) {
			return null;
		}
		tasks[ index ] = { ...tasks[ index ], ...updates, updatedAt: Date.now() };
		updated = tasks[ index ];
		await saveUserData( { ...userData, tasks } );
	} finally {
		await unlockAppdata();
	}

	if ( updated ) {
		await sendIpcEventToRenderer( 'task-updated', updated );
	}
	return updated;
}

export async function archiveTask( _event: IpcMainInvokeEvent, taskId: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const tasks = userData.tasks ?? [];
		const index = tasks.findIndex( ( t ) => t.id === taskId );
		if ( index !== -1 ) {
			tasks[ index ] = { ...tasks[ index ], archived: true, updatedAt: Date.now() };
			await saveUserData( { ...userData, tasks } );
			await sendIpcEventToRenderer( 'task-updated', tasks[ index ] );
		}
	} finally {
		await unlockAppdata();
	}
}

export async function deleteTask( _event: IpcMainInvokeEvent, taskId: string ): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const tasks = ( userData.tasks ?? [] ).filter( ( t ) => t.id !== taskId );
		await saveUserData( { ...userData, tasks } );
	} finally {
		await unlockAppdata();
	}

	await sendIpcEventToRenderer( 'task-deleted', taskId );
}

export async function updateTaskStatus(
	_event: IpcMainInvokeEvent,
	taskId: string,
	status: TaskStatus
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const tasks = userData.tasks ?? [];
		const index = tasks.findIndex( ( t ) => t.id === taskId );
		if ( index !== -1 ) {
			tasks[ index ] = { ...tasks[ index ], status, updatedAt: Date.now() };
			await saveUserData( { ...userData, tasks } );
			await sendIpcEventToRenderer( 'task-updated', tasks[ index ] );
		}
	} finally {
		await unlockAppdata();
	}
}

export async function clearArchivedTasks( _event: IpcMainInvokeEvent ): Promise< string[] > {
	let removedIds: string[] = [];

	try {
		await lockAppdata();
		const userData = await loadUserData();
		const allTasks = userData.tasks ?? [];
		const archived = allTasks.filter( ( t ) => t.archived );
		removedIds = archived.map( ( t ) => t.id );
		const remaining = allTasks.filter( ( t ) => ! t.archived );
		await saveUserData( { ...userData, tasks: remaining } );
	} finally {
		await unlockAppdata();
	}

	for ( const id of removedIds ) {
		await sendIpcEventToRenderer( 'task-deleted', id );
	}
	return removedIds;
}

// Agent lifecycle handlers

export async function startTaskAgentHandler(
	_event: IpcMainInvokeEvent,
	taskId: string,
	prompt: string,
	resumeSessionId?: string,
	images?: ImageAttachment[]
): Promise< void > {
	await startAgent( taskId, prompt, resumeSessionId, images );
}

export async function sendTaskMessageHandler(
	_event: IpcMainInvokeEvent,
	taskId: string,
	message: string,
	images?: ImageAttachment[]
): Promise< void > {
	await sendMessage( taskId, message, images );
}

export async function interruptTaskHandler(
	_event: IpcMainInvokeEvent,
	taskId: string
): Promise< void > {
	interrupt( taskId );
}

export async function respondToPermissionRequestHandler(
	_event: IpcMainInvokeEvent,
	requestId: string,
	response: PermissionResponse,
	taskId?: string
): Promise< void > {
	respondPermission( requestId, response, taskId );
}
