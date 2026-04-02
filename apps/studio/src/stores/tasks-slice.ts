import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { LOCAL_STORAGE_TASK_MESSAGES_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type {
	PermissionRequest,
	TaskMessage,
	TaskMetadata,
	TaskStatus,
} from 'src/modules/ai/types';

export interface TasksState {
	tasks: TaskMetadata[];
	selectedTaskId: string | null;
	pendingNewTask: boolean;
	messagesByTask: Record< string, TaskMessage[] >;
	streamingByTask: Record< string, boolean >;
	pendingPermissions: PermissionRequest[];
	loaded: boolean;
}

function loadPersistedMessages(): Record< string, TaskMessage[] > {
	try {
		const stored = localStorage.getItem( LOCAL_STORAGE_TASK_MESSAGES_KEY );
		if ( stored ) {
			return JSON.parse( stored );
		}
	} catch {
		// Ignore corrupt data
	}
	return {};
}

const initialState: TasksState = {
	tasks: [],
	selectedTaskId: null,
	pendingNewTask: false,
	messagesByTask: typeof window !== 'undefined' ? loadPersistedMessages() : {},
	streamingByTask: {},
	pendingPermissions: [],
	loaded: false,
};

export const loadTasks = createAsyncThunk( 'tasks/loadAll', async () => {
	return await getIpcApi().getAllTasks();
} );

export const createNewTask = createAsyncThunk( 'tasks/create', async ( siteId: string ) => {
	return await getIpcApi().createTask( siteId );
} );

export const archiveTaskThunk = createAsyncThunk( 'tasks/archive', async ( taskId: string ) => {
	await getIpcApi().archiveTask( taskId );
	return taskId;
} );

export const deleteTaskThunk = createAsyncThunk( 'tasks/delete', async ( taskId: string ) => {
	await getIpcApi().deleteTask( taskId );
	return taskId;
} );

export const clearArchivedTasksThunk = createAsyncThunk( 'tasks/clearArchived', async () => {
	return await getIpcApi().clearArchivedTasks();
} );

const tasksSlice = createSlice( {
	name: 'tasks',
	initialState,
	reducers: {
		setSelectedTaskId( state, action: PayloadAction< string | null > ) {
			state.selectedTaskId = action.payload;
			state.pendingNewTask = false;
		},
		setPendingNewTask( state, action: PayloadAction< boolean > ) {
			state.pendingNewTask = action.payload;
			if ( action.payload ) {
				state.selectedTaskId = null;
			}
		},
		taskUpdatedFromMain( state, action: PayloadAction< TaskMetadata > ) {
			const index = state.tasks.findIndex( ( t ) => t.id === action.payload.id );
			if ( index !== -1 ) {
				state.tasks[ index ] = action.payload;
			} else {
				state.tasks.push( action.payload );
			}
		},
		taskDeletedFromMain( state, action: PayloadAction< string > ) {
			state.tasks = state.tasks.filter( ( t ) => t.id !== action.payload );
			delete state.messagesByTask[ action.payload ];
			delete state.streamingByTask[ action.payload ];
			if ( state.selectedTaskId === action.payload ) {
				state.selectedTaskId = null;
			}
		},
		appendTaskMessage( state, action: PayloadAction< { taskId: string; message: TaskMessage } > ) {
			const { taskId, message } = action.payload;
			if ( ! state.messagesByTask[ taskId ] ) {
				state.messagesByTask[ taskId ] = [];
			}

			const messages = state.messagesByTask[ taskId ];

			// Tool results (id: "result-{tool_use_id}") merge onto the original tool invocation
			if ( message.id.startsWith( 'result-' ) ) {
				const toolUseId = message.id.slice( 7 ); // strip "result-" prefix
				const invocation = messages.findIndex( ( m ) => m.id === toolUseId );
				if ( invocation !== -1 ) {
					messages[ invocation ] = {
						...messages[ invocation ],
						toolResult: message.toolResult ?? message.content,
						isStreaming: false,
						isError: message.isError,
					};
					return;
				}
			}

			// Tool progress (id: "progress-{tool_use_id}") updates the original invocation
			if ( message.id.startsWith( 'progress-' ) ) {
				const toolUseId = message.id.slice( 9 );
				const invocation = messages.findIndex( ( m ) => m.id === toolUseId );
				if ( invocation !== -1 ) {
					messages[ invocation ] = {
						...messages[ invocation ],
						isStreaming: true,
					};
					return;
				}
			}

			// Update existing message or append new one
			const existing = messages.findIndex( ( m ) => m.id === message.id );
			if ( existing !== -1 ) {
				messages[ existing ] = message;
			} else {
				messages.push( message );
			}
		},
		setTaskStreaming( state, action: PayloadAction< { taskId: string; streaming: boolean } > ) {
			state.streamingByTask[ action.payload.taskId ] = action.payload.streaming;
		},
		addPermissionRequest( state, action: PayloadAction< PermissionRequest > ) {
			state.pendingPermissions.push( action.payload );
		},
		removePermissionRequest( state, action: PayloadAction< string > ) {
			state.pendingPermissions = state.pendingPermissions.filter(
				( p ) => p.requestId !== action.payload
			);
		},
		setTaskStatus( state, action: PayloadAction< { taskId: string; status: TaskStatus } > ) {
			const task = state.tasks.find( ( t ) => t.id === action.payload.taskId );
			if ( task ) {
				task.status = action.payload.status;
				task.updatedAt = Date.now();
			}
		},
	},
	extraReducers: ( builder ) => {
		builder.addCase( loadTasks.fulfilled, ( state, action ) => {
			state.tasks = action.payload;
			state.loaded = true;
		} );
		builder.addCase( createNewTask.fulfilled, ( state, action ) => {
			// The IPC event listener (taskUpdatedFromMain) may have already added this task
			const exists = state.tasks.some( ( t ) => t.id === action.payload.id );
			if ( ! exists ) {
				state.tasks.push( action.payload );
			}
			state.selectedTaskId = action.payload.id;
			state.pendingNewTask = false;
		} );
		builder.addCase( archiveTaskThunk.fulfilled, ( state, action ) => {
			const task = state.tasks.find( ( t ) => t.id === action.payload );
			if ( task ) {
				task.archived = true;
			}
			if ( state.selectedTaskId === action.payload ) {
				state.selectedTaskId = null;
			}
		} );
		builder.addCase( deleteTaskThunk.fulfilled, ( state, action ) => {
			state.tasks = state.tasks.filter( ( t ) => t.id !== action.payload );
			delete state.messagesByTask[ action.payload ];
			if ( state.selectedTaskId === action.payload ) {
				state.selectedTaskId = null;
			}
		} );
		builder.addCase( clearArchivedTasksThunk.fulfilled, ( state, action ) => {
			const removedIds = new Set( action.payload );
			state.tasks = state.tasks.filter( ( t ) => ! removedIds.has( t.id ) );
			for ( const id of removedIds ) {
				delete state.messagesByTask[ id ];
				delete state.streamingByTask[ id ];
			}
			if ( state.selectedTaskId && removedIds.has( state.selectedTaskId ) ) {
				state.selectedTaskId = null;
			}
		} );
	},
} );

export const {
	setSelectedTaskId,
	setPendingNewTask,
	taskUpdatedFromMain,
	taskDeletedFromMain,
	appendTaskMessage,
	setTaskStreaming,
	addPermissionRequest,
	removePermissionRequest,
	setTaskStatus,
} = tasksSlice.actions;

export const tasksReducer = tasksSlice.reducer;
