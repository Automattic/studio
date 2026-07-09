import fsPromises from 'fs/promises';
import { confirm } from '@inquirer/prompts';
import { CheckpointEvents, type CheckpointIpcEvent } from '@studio/common/lib/checkpoint-events';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import Table from 'cli-table3';
import {
	createCheckpoint,
	isCheckpointSupported,
	runGarbageCollection,
} from 'cli/lib/checkpoints/create';
import { diffCheckpoints } from 'cli/lib/checkpoints/diff';
import { CheckpointEventEmitter } from 'cli/lib/checkpoints/events';
import {
	getManifestPath,
	readCheckpointIndex,
	readRestoreJournal,
	updateCheckpointIndex,
} from 'cli/lib/checkpoints/manifest';
import { restoreCheckpoint } from 'cli/lib/checkpoints/restore';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

function createReportingEmitter(): CheckpointEventEmitter {
	const emitter = new CheckpointEventEmitter();
	const sendIpcEvent = ( eventTuple: CheckpointIpcEvent[ 'checkpointEvent' ] ) => {
		const ipcEvent: CheckpointIpcEvent = { checkpointEvent: eventTuple };
		process.send!( ipcEvent );
	};

	if ( process.send ) {
		emitter.on( CheckpointEvents.CHECKPOINT_CREATE_START, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_CREATE_START, data ] )
		);
		emitter.on( CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, data ] )
		);
		emitter.on( CheckpointEvents.CHECKPOINT_CREATE_COMPLETE, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_CREATE_COMPLETE, data ] )
		);
		emitter.on( CheckpointEvents.CHECKPOINT_CREATE_ERROR, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_CREATE_ERROR, data ] )
		);
		emitter.on( CheckpointEvents.CHECKPOINT_RESTORE_START, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_RESTORE_START, data ] )
		);
		emitter.on( CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, data ] )
		);
		emitter.on( CheckpointEvents.CHECKPOINT_RESTORE_COMPLETE, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_RESTORE_COMPLETE, data ] )
		);
		emitter.on( CheckpointEvents.CHECKPOINT_RESTORE_ERROR, ( data ) =>
			sendIpcEvent( [ CheckpointEvents.CHECKPOINT_RESTORE_ERROR, data ] )
		);
	} else {
		emitter.on( CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, ( data ) => {
			if ( data.processed && data.total ) {
				logger.reportProgress(
					sprintf( __( 'Capturing site files… (%1$d/%2$d)' ), data.processed, data.total )
				);
			}
		} );
		emitter.on( CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, ( data ) => {
			if ( data.processed && data.total ) {
				logger.reportProgress(
					sprintf( __( 'Restoring site files… (%1$d/%2$d)' ), data.processed, data.total )
				);
			}
		} );
	}

	return emitter;
}

function formatBytes( bytes: number ): string {
	if ( bytes < 1024 ) {
		return `${ bytes } B`;
	}
	if ( bytes < 1024 * 1024 ) {
		return `${ ( bytes / 1024 ).toFixed( 1 ) } KB`;
	}
	if ( bytes < 1024 * 1024 * 1024 ) {
		return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;
	}
	return `${ ( bytes / ( 1024 * 1024 * 1024 ) ).toFixed( 2 ) } GB`;
}

function getTriggerLabel( trigger: string ): string {
	switch ( trigger ) {
		case 'manual':
			return __( 'Manual' );
		case 'agent':
			return __( 'Agent' );
		case 'auto-pre-tool':
			return __( 'Auto' );
		case 'pre-restore':
			return __( 'Safety' );
		default:
			return trigger;
	}
}

export async function runCreateCommand( siteFolder: string, label?: string ): Promise< void > {
	try {
		await connectToDaemon();
		const site = await getSiteByFolder( siteFolder );
		if ( ! isCheckpointSupported( site ) ) {
			throw new LoggerError(
				__( 'Checkpoints are not yet supported for sites imported with `studio pull-reprint`.' )
			);
		}

		logger.reportStart( LoggerAction.EXPORT_SITE, __( 'Creating checkpoint…' ) );
		const manifest = await createCheckpoint( site, {
			label,
			trigger: 'manual',
			emitter: createReportingEmitter(),
		} );
		logger.reportSuccess(
			sprintf(
				__( 'Checkpoint %1$s created (%2$s new data, %3$d files)' ),
				manifest.id,
				formatBytes( manifest.stats.newObjectBytes ),
				manifest.stats.fileCount
			)
		);
	} finally {
		await disconnectFromDaemon();
	}
}

export async function runListCommand( siteFolder: string, asJson: boolean ): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	const index = await readCheckpointIndex( site.id );
	const journal = await readRestoreJournal( site.id );

	if ( asJson ) {
		console.log(
			JSON.stringify( { checkpoints: index.checkpoints, interruptedRestore: journal }, null, 2 )
		);
		return;
	}

	if ( index.checkpoints.length === 0 ) {
		console.log( __( 'No checkpoints yet. Create one with `studio checkpoint create`.' ) );
		return;
	}

	const table = new Table( {
		head: [ __( 'ID' ), __( 'Label' ), __( 'Type' ), __( 'Created' ), __( 'New data' ) ],
	} );
	for ( const entry of [ ...index.checkpoints ].reverse() ) {
		table.push( [
			entry.id,
			entry.label ?? ( entry.toolName ? sprintf( __( 'Before %s' ), entry.toolName ) : '—' ),
			getTriggerLabel( entry.trigger ),
			new Date( entry.createdAt ).toLocaleString(),
			formatBytes( entry.stats.newObjectBytes ),
		] );
	}
	console.log( table.toString() );

	if ( journal ) {
		console.warn(
			sprintf(
				__(
					'Warning: a restore of %s was interrupted. Run `studio checkpoint restore %s` to re-apply it.'
				),
				journal.checkpointId,
				journal.checkpointId
			)
		);
	}
}

export async function runRestoreCommand(
	siteFolder: string,
	checkpointId: string,
	skipConfirm: boolean
): Promise< void > {
	try {
		await connectToDaemon();
		const site = await getSiteByFolder( siteFolder );

		if ( ! skipConfirm ) {
			const confirmed = await confirm( {
				message: sprintf(
					__(
						'Restore site files AND database to checkpoint %s? A safety checkpoint of the current state will be created first.'
					),
					checkpointId
				),
				default: false,
			} );
			if ( ! confirmed ) {
				return;
			}
		}

		const journal = await readRestoreJournal( site.id );
		const resumingInterrupted = journal?.checkpointId === checkpointId;

		logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Restoring checkpoint…' ) );
		const result = await restoreCheckpoint( site, checkpointId, logger, {
			emitter: createReportingEmitter(),
			// Re-applying an interrupted restore reuses the safety checkpoint
			// from the first attempt instead of capturing the half-restored tree.
			skipSafetyCheckpoint: resumingInterrupted,
		} );
		logger.reportSuccess(
			result.safetyCheckpointId
				? sprintf(
						__( 'Checkpoint %1$s restored. Undo with `studio checkpoint restore %2$s`.' ),
						result.checkpointId,
						result.safetyCheckpointId
				  )
				: sprintf( __( 'Checkpoint %s restored.' ), result.checkpointId )
		);
	} finally {
		await disconnectFromDaemon();
	}
}

export async function runDeleteCommand(
	siteFolder: string,
	checkpointId: string | undefined,
	autoOnly: boolean
): Promise< void > {
	const site = await getSiteByFolder( siteFolder );

	const removedIds: string[] = [];
	await updateCheckpointIndex( site.id, ( index ) => {
		const shouldRemove = ( entry: { id: string; trigger: string; pinned?: boolean } ) => {
			if ( entry.pinned ) {
				return false;
			}
			if ( autoOnly ) {
				return entry.trigger === 'auto-pre-tool' || entry.trigger === 'pre-restore';
			}
			return entry.id === checkpointId;
		};
		index.checkpoints = index.checkpoints.filter( ( entry ) => {
			if ( shouldRemove( entry ) ) {
				removedIds.push( entry.id );
				return false;
			}
			return true;
		} );
		return index;
	} );

	if ( ! autoOnly && removedIds.length === 0 ) {
		throw new LoggerError( sprintf( __( 'Checkpoint not found: %s' ), checkpointId ?? '' ) );
	}

	for ( const removedId of removedIds ) {
		await fsPromises.rm( getManifestPath( site.id, removedId ), { force: true } );
	}
	const swept = await runGarbageCollection( site.id );
	logger.reportSuccess(
		sprintf(
			__( 'Deleted %1$d checkpoint(s), reclaimed %2$d object(s).' ),
			removedIds.length,
			swept
		)
	);
}

export async function runDiffCommand(
	siteFolder: string,
	fromId: string,
	toId: string,
	asJson: boolean
): Promise< void > {
	try {
		await connectToDaemon();
		const site = await getSiteByFolder( siteFolder );
		const diff = await diffCheckpoints( site, fromId, toId );

		if ( asJson ) {
			console.log( JSON.stringify( diff, null, 2 ) );
			return;
		}

		const summarize = ( entries: Array< { path: string } >, verb: string ) => {
			if ( entries.length === 0 ) {
				return;
			}
			console.log( `${ verb } (${ entries.length }):` );
			for ( const entry of entries.slice( 0, 25 ) ) {
				console.log( `  ${ entry.path }` );
			}
			if ( entries.length > 25 ) {
				console.log( sprintf( __( '  …and %d more' ), entries.length - 25 ) );
			}
		};
		summarize( diff.files.added, __( 'Added' ) );
		summarize( diff.files.modified, __( 'Modified' ) );
		summarize( diff.files.deleted, __( 'Deleted' ) );
		if (
			diff.files.added.length === 0 &&
			diff.files.modified.length === 0 &&
			diff.files.deleted.length === 0
		) {
			console.log( __( 'No file changes.' ) );
		}

		if ( diff.database.detailed ) {
			const {
				changedTables = [],
				addedTables = [],
				removedTables = [],
				changedOptions = [],
			} = diff.database;
			if (
				changedTables.length === 0 &&
				addedTables.length === 0 &&
				removedTables.length === 0 &&
				changedOptions.length === 0
			) {
				console.log( __( 'No database changes.' ) );
			} else {
				console.log( __( 'Database changes:' ) );
				for ( const change of changedTables ) {
					console.log( `  ${ change.table }: ${ change.fromRows } → ${ change.toRows } rows` );
				}
				for ( const table of addedTables ) {
					console.log( sprintf( __( '  %s: table added' ), table ) );
				}
				for ( const table of removedTables ) {
					console.log( sprintf( __( '  %s: table removed' ), table ) );
				}
				if ( changedOptions.length > 0 ) {
					console.log(
						sprintf( __( '  Changed options: %s' ), changedOptions.slice( 0, 15 ).join( ', ' ) )
					);
				}
			}
		} else {
			console.log(
				sprintf(
					__( 'Database size change: %s bytes (detailed diff unavailable).' ),
					String( diff.database.sizeDelta ?? 0 )
				)
			);
		}
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command(
		'checkpoint',
		__( 'Manage site checkpoints (files + database save points)' ),
		( checkpointYargs ) => {
			const withPath = < T >( commandYargs: StudioArgv & T ) =>
				commandYargs.option( 'path', {
					type: 'string',
					description: __( 'Path to the site directory' ),
					default: process.cwd(),
					coerce: untildify,
				} );

			checkpointYargs
				.command( {
					command: 'create',
					describe: __( 'Capture the current site state (files + database)' ),
					builder: ( commandYargs ) =>
						withPath( commandYargs ).option( 'label', {
							type: 'string',
							description: __( 'A short description of this checkpoint' ),
						} ),
					handler: async ( argv ) => {
						try {
							await runCreateCommand( argv.path as string, argv.label as string | undefined );
						} catch ( error ) {
							logger.reportError(
								error instanceof LoggerError
									? error
									: new LoggerError( __( 'Failed to create checkpoint' ), error )
							);
						}
					},
				} )
				.command( {
					command: 'list',
					describe: __( 'List checkpoints for a site' ),
					builder: ( commandYargs ) =>
						withPath( commandYargs ).option( 'json', {
							type: 'boolean',
							default: false,
							description: __( 'Output as JSON' ),
						} ),
					handler: async ( argv ) => {
						try {
							await runListCommand( argv.path as string, argv.json as boolean );
						} catch ( error ) {
							logger.reportError(
								error instanceof LoggerError
									? error
									: new LoggerError( __( 'Failed to list checkpoints' ), error )
							);
						}
					},
				} )
				.command( {
					command: 'restore <checkpoint-id>',
					describe: __( 'Restore the site to a checkpoint (files + database)' ),
					builder: ( commandYargs ) =>
						withPath( commandYargs ).option( 'yes', {
							type: 'boolean',
							default: false,
							description: __( 'Skip the confirmation prompt' ),
						} ),
					handler: async ( argv ) => {
						try {
							await runRestoreCommand(
								argv.path as string,
								argv[ 'checkpoint-id' ] as string,
								argv.yes as boolean
							);
						} catch ( error ) {
							logger.reportError(
								error instanceof LoggerError
									? error
									: new LoggerError( __( 'Failed to restore checkpoint' ), error )
							);
						}
					},
				} )
				.command( {
					command: 'delete [checkpoint-id]',
					describe: __( 'Delete a checkpoint, or all automatic ones with --auto-only' ),
					builder: ( commandYargs ) =>
						withPath( commandYargs ).option( 'auto-only', {
							type: 'boolean',
							default: false,
							description: __( 'Delete all automatic and safety checkpoints' ),
						} ),
					handler: async ( argv ) => {
						try {
							const checkpointId = argv[ 'checkpoint-id' ] as string | undefined;
							if ( ! checkpointId && ! argv[ 'auto-only' ] ) {
								throw new LoggerError( __( 'Provide a checkpoint id or use --auto-only.' ) );
							}
							await runDeleteCommand(
								argv.path as string,
								checkpointId,
								argv[ 'auto-only' ] as boolean
							);
						} catch ( error ) {
							logger.reportError(
								error instanceof LoggerError
									? error
									: new LoggerError( __( 'Failed to delete checkpoint' ), error )
							);
						}
					},
				} )
				.command( {
					command: 'diff <from-id> [to-id]',
					describe: __(
						'Show what changed between two checkpoints, or a checkpoint and the current state'
					),
					builder: ( commandYargs ) =>
						withPath( commandYargs ).option( 'json', {
							type: 'boolean',
							default: false,
							description: __( 'Output as JSON' ),
						} ),
					handler: async ( argv ) => {
						try {
							await runDiffCommand(
								argv.path as string,
								argv[ 'from-id' ] as string,
								( argv[ 'to-id' ] as string | undefined ) ?? 'current',
								argv.json as boolean
							);
						} catch ( error ) {
							logger.reportError(
								error instanceof LoggerError
									? error
									: new LoggerError( __( 'Failed to diff checkpoints' ), error )
							);
						}
					},
				} )
				.demandCommand( 1, __( 'Specify a checkpoint subcommand.' ) );
		}
	);
};
