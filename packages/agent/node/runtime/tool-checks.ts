/**
 * Studio's work around each tool call: the questions it asks first, the block
 * validation and pending work it waits for, the checks of what the call
 * changed on the sites, and the notes they leave on the result.
 */
import fs from 'fs';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import { type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { classicThemeQuestion } from '@studio/agent/node/block-theme';
import { type BlockValidationGate } from '@studio/agent/node/block-validation-gate';
import { NO_CHANGES, type SiteChanges } from '@studio/agent/node/site-changes';
import { type SiteNotes } from '@studio/agent/node/site-notes';
import { studioMessage, validationLines } from '@studio/agent/node/studio-message';
import { siteOfCall } from '@studio/agent/node/tools/utils';
import { describeDestructiveCall, type Confirmer } from './confirmation';
import {
	getIncompleteToolCallReason,
	getWrittenFile,
	getWrittenText,
	type StudioToolPayloadGuardState,
} from './tool-safety';
import type { PendingWork } from './pending-work';
import type { SitePin } from './site-pin';
import type { Writers } from './writers';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { RenderCheck } from '@studio/agent/node/render-check';
import type { StudioToolResultDetails } from '@studio/agent/node/tools/define-tool';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

// A shell command can put content on the site through WP-CLI.
const BLOCK_VALIDATION_GATED_TOOLS = new Set( [ 'Bash', 'take_screenshot' ] );
// pi's tools that change nothing on a site, so there is nothing to check after
// them. Studio's tools declare it (readOnlyHint, as MCP tool annotations do).
const READ_ONLY_TOOLS = new Set( [ 'Read', 'Grep', 'Glob', 'Ls' ] );

/**
 * The checks of what a call changed, run while the model reads its result and
 * decides on the next call: in the eval the model took 3s (median) after a
 * result, the checks 1.3s. Their notes reach the agent with the next result,
 * or at the end of the turn. Each call waits for them before it runs, so
 * every check sees the site as the call left it, a fix a check saves never
 * meets the next call's writes, and the next call's snapshot follows them.
 */
export class AfterChecks {
	private running: Promise< void > = Promise.resolve();
	// Their time by check, which the next call to return carries, as they
	// finish after the call they check has returned.
	private stagesMs: Record< string, number > = {};

	constructor( private readonly pendingWork: PendingWork ) {}

	async timed< T >( stage: string, check: () => Promise< T > ): Promise< T > {
		const from = Date.now();
		try {
			return await check();
		} finally {
			const key = `after ${ stage }`;
			this.stagesMs[ key ] = ( this.stagesMs[ key ] ?? 0 ) + Date.now() - from;
		}
	}

	takeStagesMs(): Record< string, number > {
		const taken = this.stagesMs;
		this.stagesMs = {};
		return taken;
	}

	// Each call's checks start once the checks before them are done: a check
	// that saves a fix reads and rewrites a file, as theme.json, that another
	// call's checks rewrite too, when the model makes calls in parallel.
	add( checks: () => Promise< string | undefined > ): void {
		const run = this.running.then( checks );
		this.pendingWork.add( run );
		this.running = run.then(
			() => undefined,
			() => undefined
		);
	}

	settle(): Promise< void > {
		return this.running;
	}
}

export function toToolDefinition(
	host: StudioAgentHost,
	tool: AgentToolAny,
	payloadGuardState: StudioToolPayloadGuardState,
	pendingWork: PendingWork,
	blockValidationGate: BlockValidationGate,
	{
		confirm,
		sitePin,
		siteNotes,
		siteChanges,
		afterChecks,
		renderCheck,
		writers,
	}: {
		confirm: Confirmer;
		sitePin: SitePin;
		siteNotes: SiteNotes;
		siteChanges: SiteChanges;
		afterChecks: AfterChecks;
		// What renders the pages a call changed, unless another turn's calls do.
		renderCheck: RenderCheck | undefined;
		writers: Writers;
	}
): ToolDefinition {
	// This agent's work reports its notes: what Studio finds in what another
	// agent wrote reaches that one.
	const mine = ( file: string ) => writers.ofFile( file ) === pendingWork;
	const elsewhere = writers.elsewhere( pendingWork );
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		prepareArguments: tool.prepareArguments,
		executionMode: tool.executionMode,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const incompleteToolCallReason = getIncompleteToolCallReason( payloadGuardState, toolCallId );
			if ( incompleteToolCallReason ) {
				throw new Error( incompleteToolCallReason );
			}
			// An irreversible call names its site in its own question, so it
			// needs no second one about which site it changes.
			const destructive = describeDestructiveCall( tool.name, params );
			const crossSite = destructive
				? undefined
				: await sitePin.confirmationFor( tool.name, params );
			const writtenFile = getWrittenFile( tool.name, params, host.sitesRoot );
			const declined = await confirm(
				destructive ??
					crossSite?.confirmation ??
					( writtenFile ? await classicThemeQuestion( writtenFile ) : undefined )
			);
			if ( declined?.endsTurn ) {
				return { content: [ { type: 'text', text: declined.text } ], details: {}, terminate: true };
			}
			if ( declined ) {
				throw new Error( declined.text );
			}
			crossSite?.allow();
			// Studio's own time on the call, from here: its checks before and after the tool runs.
			const checksStarted = Date.now();
			let ranMs = 0;
			// Studio's time by check, for a profile of where it goes.
			const checkStagesMs: Record< string, number > = {};
			const timeCheck = async < T >( stage: string, check: () => Promise< T > ): Promise< T > => {
				const from = Date.now();
				try {
					return await check();
				} finally {
					checkStagesMs[ stage ] = ( checkStagesMs[ stage ] ?? 0 ) + Date.now() - from;
				}
			};
			await timeCheck( 'previousChecks', () => afterChecks.settle() );
			const fileWriteRefusal =
				writtenFile &&
				( await siteNotes.beforeWrite( writtenFile, getWrittenText( tool.name, params ) ) );
			if ( fileWriteRefusal ) {
				throw new Error( fileWriteRefusal );
			}
			if ( writtenFile ) {
				writers.claim( pendingWork, writtenFile );
			}
			await timeCheck( 'pendingWork', async () => {
				if ( ( tool as { settlesPendingWork?: boolean } ).settlesPendingWork ) {
					await pendingWork.settle();
				} else if ( ! ( tool as { startsAtOnce?: boolean } ).startsAtOnce ) {
					// A file written or edited is all such a call touches: markup naming
					// an image still being generated reads nothing of it.
					await pendingWork.settleFilesIn( writtenFile ?? params );
				}
			} );
			// Block markup written since the last check is validated before any
			// tool puts content on the site or renders it; any other call carries
			// the validations already done, so a problem is heard while the agent
			// is still writing, not when it first looks at the page.
			const validation = await timeCheck( 'blockValidation', () =>
				blockValidationGate.settle(
					BLOCK_VALIDATION_GATED_TOOLS.has( tool.name )
						? { mine }
						: { ready: true, except: writtenFile, mine }
				)
			);
			if ( validation.saved.length ) {
				siteChanges.stale();
			}
			const validationReport = validationLines( validation );
			const checksChanges = ! (
				READ_ONLY_TOOLS.has( tool.name ) ||
				( tool as { annotations?: { readOnlyHint?: boolean } } ).annotations?.readOnlyHint
			);
			if ( checksChanges ) {
				await timeCheck( 'siteChanges', () => siteChanges.begin().catch( () => undefined ) );
				await timeCheck( 'render', () =>
					Promise.all(
						sitePin.localSitePaths().map( ( sitePath ) => renderCheck?.seen( sitePath ) )
					)
				);
			}
			// A call that fails can still have changed content, as a shell
			// command does that exits non-zero after saving a page.
			const settled = async ( time: typeof timeCheck ) =>
				checksChanges
					? await time( 'siteChanges', () =>
							siteChanges.settle( elsewhere ).catch( () => NO_CHANGES )
					  )
					: NO_CHANGES;
			// The validation report was taken from the gate, so it rides on a failure too.
			const ranFrom = Date.now();
			const result = await tool
				.execute( toolCallId, params, signal, onUpdate )
				.finally( () => {
					ranMs = Date.now() - ranFrom;
				} )
				.catch( async ( error: unknown ) => {
					const changed = await settled( timeCheck );
					const report = studioMessage( 'notes', [
						...validationReport,
						...changed.summaries,
						...changed.problems,
					] );
					if ( ! report ) {
						throw error;
					}
					throw new Error(
						`${ error instanceof Error ? error.message : String( error ) }\n${ report }`
					);
				} );
			// The file as the tool left it, which is the text the agent holds.
			const left = writtenFile ? readFileText( writtenFile ) : undefined;
			if ( tool.name === 'site_create' ) {
				const name = String( ( params as { name?: unknown } ).name );
				await sitePin.created( name );
				const created = await host.sites
					.resolve( name )
					.then( ( site ) => site.path )
					.catch( () => undefined );
				if ( created ) {
					await renderCheck?.seen( created, { created: true } );
				}
			}
			const details = result.details as StudioToolResultDetails | undefined;
			if ( details?.pending ) {
				// What it writes as it finishes is no call's change.
				void details.pending.finally( () => siteChanges.stale() ).catch( () => undefined );
				pendingWork.add( details.pending, details.pendingFiles );
				delete details.pending;
				delete details.pendingFiles;
			}
			// The site a call names, or else the request's own, whose facts any
			// call can change, as a shell command installing a plugin does.
			const resultSite =
				( await siteOfCall( host, tool, params ) )?.path ?? sitePin.localRequestSite();
			const resultText = result.content
				.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
				.join( '\n' );
			const afterTime: typeof timeCheck = ( stage, check ) => afterChecks.timed( stage, check );
			afterChecks.add( async () => {
				const changed = await settled( afterTime );
				if ( checksChanges ) {
					await afterTime( 'render', () =>
						Promise.all(
							sitePin.localSitePaths().map( ( sitePath ) => renderCheck?.changed( sitePath ) )
						)
					);
				}
				// The files the call wrote, by its file tool or otherwise, as a shell command does.
				const written = new Set( [
					...( writtenFile ? [ writtenFile ] : [] ),
					...changed.written,
				] );
				// One file at a time: the notes on each can save a fix to the same file.
				const fileNotes: string[] = [];
				for ( const file of written ) {
					fileNotes.push(
						...( await afterTime( 'fileNotes', () =>
							siteNotes.afterWrite( file, file === writtenFile ? left : undefined )
						) )
					);
				}
				const resultNotes = resultSite
					? await afterTime( 'resultNotes', () => siteNotes.afterResult( resultSite, resultText ) )
					: [];
				if ( checksChanges ) {
					// The fixes above saved: the next call starts from the sites as they leave them.
					siteChanges.afterChecks();
				}
				return [ ...changed.summaries, ...changed.problems, ...fileNotes, ...resultNotes ]
					.filter( Boolean )
					.join( '\n' );
			} );
			if ( ( tool as { reportsChecks?: boolean } ).reportsChecks ) {
				await timeCheck( 'ownChecks', () => afterChecks.settle() );
			}
			const reports = studioMessage( 'notes', [
				...validationReport,
				pendingWork.takeReports(),
				renderCheck?.takeReports(),
			] );
			const timed = {
				...result,
				details: {
					...( result.details as object ),
					checksMs: Date.now() - checksStarted - ranMs,
					checkStagesMs: { ...checkStagesMs, ...afterChecks.takeStagesMs() },
					checkSourcesMs: {
						...( checksChanges && siteChanges.takeSourceMs() ),
						...Object.fromEntries(
							Object.entries( siteNotes.takeSourceMs() ).map( ( [ name, ms ] ) => [
								`notes ${ name }`,
								ms,
							] )
						),
					},
				},
			};
			return reports
				? { ...timed, content: [ ...result.content, { type: 'text', text: reports } ] }
				: timed;
		},
	};
}

function readFileText( file: string ): string | undefined {
	try {
		return fs.readFileSync( file, 'utf8' );
	} catch {
		return undefined;
	}
}

// Every chunk of the CLI bundle sits next to `main.mjs`, so it is this
// module's sibling; `STUDIO_CLI_BIN` points elsewhere in development.
