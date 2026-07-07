import { Type } from 'typebox';
import { createCheckpoint, isCheckpointSupported } from 'cli/lib/checkpoints/create';
import { diffCheckpoints, type CheckpointDiff } from 'cli/lib/checkpoints/diff';
import { readCheckpointIndex, readRestoreJournal } from 'cli/lib/checkpoints/manifest';
import { restoreCheckpoint } from 'cli/lib/checkpoints/restore';
import { Logger } from 'cli/logger';
import { defineTool, type ToolResult } from './define-tool';
import { resolveSite, textResult } from './utils';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';
import type { CheckpointManifest } from 'cli/lib/checkpoints/manifest';

function checkpointArtifact(
	manifest: Pick< CheckpointManifest, 'id' | 'siteId' | 'label' | 'createdAt' | 'trigger' > & {
		toolName?: string;
	}
): StudioChatArtifactWidgetDraft {
	return {
		type: 'checkpoint',
		widgetProps: {
			checkpointId: manifest.id,
			siteId: manifest.siteId,
			label: manifest.label ?? null,
			trigger: manifest.trigger,
			toolName: manifest.toolName ?? null,
			createdAt: manifest.createdAt,
		},
	};
}

export function formatDiffSummary( diff: CheckpointDiff ): string {
	const lines: string[] = [];
	const { added, modified, deleted } = diff.files;

	if ( added.length === 0 && modified.length === 0 && deleted.length === 0 ) {
		lines.push( 'Files: no changes.' );
	} else {
		lines.push(
			`Files: ${ added.length } added, ${ modified.length } modified, ${ deleted.length } deleted.`
		);
		const sample = ( entries: Array< { path: string } >, verb: string ) => {
			for ( const entry of entries.slice( 0, 15 ) ) {
				lines.push( `  ${ verb } ${ entry.path }` );
			}
			if ( entries.length > 15 ) {
				lines.push( `  …and ${ entries.length - 15 } more ${ verb.toLowerCase() }` );
			}
		};
		sample( added, 'added' );
		sample( modified, 'modified' );
		sample( deleted, 'deleted' );
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
			lines.push( 'Database: no changes.' );
		} else {
			lines.push( 'Database changes:' );
			for ( const change of changedTables ) {
				lines.push( `  ${ change.table }: ${ change.fromRows } → ${ change.toRows } rows` );
			}
			for ( const table of addedTables ) {
				lines.push( `  ${ table }: table added` );
			}
			for ( const table of removedTables ) {
				lines.push( `  ${ table }: table removed` );
			}
			if ( changedOptions.length > 0 ) {
				lines.push(
					`  changed options: ${ changedOptions.slice( 0, 20 ).join( ', ' ) }${
						changedOptions.length > 20 ? `, …and ${ changedOptions.length - 20 } more` : ''
					}`
				);
			}
		}
	} else {
		lines.push(
			`Database: changed by ${ diff.database.sizeDelta ?? 0 } bytes (detailed diff unavailable).`
		);
	}

	return lines.join( '\n' );
}

export const createCheckpointTool = defineTool(
	'checkpoint_create',
	'Captures the entire current state of a local site — all files AND the database — as a checkpoint ' +
		'that can be restored later with checkpoint_restore. Create one after completing meaningful work ' +
		'(a plugin configured, a theme change finished) or before starting something risky. ' +
		'Cheap to create: unchanged files are deduplicated, so only new data costs disk space.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path' } ),
		label: Type.Optional(
			Type.String( {
				description:
					'A short human-readable description of the state, e.g. "Contact form plugin configured".',
			} )
		),
	},
	async ( args ): Promise< ToolResult > => {
		const site = await resolveSite( args.nameOrPath );
		const manifest = await createCheckpoint( site, {
			label: args.label,
			trigger: 'agent',
		} );
		return {
			content: [
				{
					type: 'text',
					text:
						`Checkpoint ${ manifest.id } created` +
						( manifest.label ? ` ("${ manifest.label }")` : '' ) +
						`. ${ manifest.stats.fileCount } files + database captured; ` +
						`${ Math.round( manifest.stats.newObjectBytes / 1024 ) } KB of new data stored.`,
				},
			],
			studioArtifacts: [ checkpointArtifact( manifest ) ],
		};
	}
);

export const listCheckpointsTool = defineTool(
	'checkpoint_list',
	'Lists the checkpoints of a local site (files + database save points), newest first. ' +
		'Use checkpoint_diff to see what changed since one, or checkpoint_restore to roll back.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path' } ),
	},
	async ( args ): Promise< ToolResult > => {
		const site = await resolveSite( args.nameOrPath );
		const index = await readCheckpointIndex( site.id );
		const journal = await readRestoreJournal( site.id );

		if ( index.checkpoints.length === 0 ) {
			return textResult( 'This site has no checkpoints yet. Create one with checkpoint_create.' );
		}

		const lines = [ ...index.checkpoints ].reverse().map( ( entry ) => {
			const label = entry.label ?? ( entry.toolName ? `before ${ entry.toolName }` : 'no label' );
			return `${ entry.id } — ${ label } [${ entry.trigger }] ${ new Date(
				entry.createdAt
			).toISOString() }`;
		} );
		if ( journal ) {
			lines.push(
				`WARNING: a restore of ${ journal.checkpointId } was interrupted; the site may be in a mixed state. Re-run checkpoint_restore with that id.`
			);
		}
		return textResult( lines.join( '\n' ) );
	}
);

export const restoreCheckpointTool = defineTool(
	'checkpoint_restore',
	'Restores a local site — all files AND the database — to a previous checkpoint. ' +
		'A safety checkpoint of the current state is created first, so the restore itself can be undone. ' +
		'If the site is running it is stopped and restarted automatically. ' +
		'Everything done after the checkpoint (posts, settings, plugin installs) is rolled back.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path' } ),
		checkpointId: Type.String( {
			description: 'The checkpoint id to restore, from checkpoint_list or checkpoint_create.',
		} ),
	},
	async ( args ): Promise< ToolResult > => {
		const site = await resolveSite( args.nameOrPath );
		const journal = await readRestoreJournal( site.id );
		const logger = new Logger< string >();
		const result = await restoreCheckpoint( site, args.checkpointId, logger, {
			skipSafetyCheckpoint: journal?.checkpointId === args.checkpointId,
		} );
		return textResult(
			`Site restored to checkpoint ${ result.checkpointId } (files + database).` +
				( result.safetyCheckpointId
					? ` The pre-restore state was saved as ${ result.safetyCheckpointId }; restore it to undo this.`
					: '' )
		);
	}
);

export const diffCheckpointTool = defineTool(
	'checkpoint_diff',
	'Shows what changed between a checkpoint and the current site state (or between two checkpoints): ' +
		'files added/modified/deleted, database tables with changed row counts, and changed wp_options entries. ' +
		'Useful for debugging — "what changed since things last worked?" — before deciding whether to restore.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path' } ),
		fromCheckpointId: Type.Optional(
			Type.String( {
				description:
					'The baseline checkpoint id. Defaults to the most recent manual or agent checkpoint.',
			} )
		),
		toCheckpointId: Type.Optional(
			Type.String( {
				description: 'The comparison checkpoint id. Defaults to the current site state.',
			} )
		),
	},
	async ( args ): Promise< ToolResult > => {
		const site = await resolveSite( args.nameOrPath );

		let fromId = args.fromCheckpointId;
		if ( ! fromId ) {
			const index = await readCheckpointIndex( site.id );
			const lastGood = [ ...index.checkpoints ]
				.reverse()
				.find( ( entry ) => entry.trigger === 'manual' || entry.trigger === 'agent' );
			if ( ! lastGood ) {
				return textResult(
					'This site has no manual or agent checkpoints to compare against. Create one with checkpoint_create, or pass fromCheckpointId explicitly.'
				);
			}
			fromId = lastGood.id;
		}

		const diff = await diffCheckpoints( site, fromId, args.toCheckpointId ?? 'current' );
		return textResult(
			`Changes from ${ fromId } to ${
				args.toCheckpointId ?? 'the current state'
			}:\n${ formatDiffSummary( diff ) }`
		);
	}
);

// Used by the auto-checkpoint decorator to know whether a site can be
// checkpointed at all before a destructive tool runs.
export { isCheckpointSupported, checkpointArtifact };
