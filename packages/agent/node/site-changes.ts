/**
 * What a call changed on the sites, checked where WordPress reads it, not on
 * the way there: content reaches a post by WP-CLI, `wp eval`, REST or an
 * import, and a theme's files by any tool or script.
 *
 * Surfaces take a snapshot before a call and settle after it, so what a call
 * changed is reported on that call's result. Each source reads one kind of
 * thing WordPress reads, as versions a check compares.
 */
import { adminCapabilities } from '@studio/agent/node/admin-capabilities';
import { blockEditorScripts } from '@studio/agent/node/block-editor-scripts';
import { renderedBlocks } from '@studio/agent/node/block-render-check';
import { blockScriptAssets } from '@studio/agent/node/block-script-assets';
import { blockStyleClasses } from '@studio/agent/node/block-style-classes';
import { blockTheme } from '@studio/agent/node/block-theme';
import { childThemeCopies } from '@studio/agent/node/child-theme-copies';
import { globalStylesFlag } from '@studio/agent/node/global-styles-flag';
import { jetpackModules } from '@studio/agent/node/jetpack-modules';
import { linksToNowhereChanges } from '@studio/agent/node/links-to-nowhere';
import { missingTemplateParts } from '@studio/agent/node/missing-template-parts';
import { postContentChanges } from '@studio/agent/node/post-content-check';
import { postCopies } from '@studio/agent/node/post-copies';
import { sectionLinks } from '@studio/agent/node/section-links';
import { siteFileWrites } from '@studio/agent/node/site-file-writes';
import { templatePartAreas } from '@studio/agent/node/template-part-areas';
import { themeErrors } from '@studio/agent/node/theme-errors';
import { updatableThemeChanges } from '@studio/agent/node/theme-file-changes';
import { themeLook } from '@studio/agent/node/theme-look';
import { themeStylesheet } from '@studio/agent/node/theme-stylesheet';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { OpenProblems } from '@studio/agent/node/open-problems';

/** Each thing's version on a site, by key. */
export type Versions = Record< string, string >;

/**
 * What a change means: a line for the result, the problem it leaves, if any,
 * and the file it wrote, for the write notes. A problem the calls of a turn
 * pass through, as a theme being written does, is raised only if it is still
 * open at the end of the turn.
 */
export interface ChangeReport {
	key: string;
	summary?: string;
	problem?: string;
	atTurnEnd?: boolean;
	written?: string;
}

/** What the calls since the last check changed. */
export interface SettledChanges {
	summaries: string[];
	problems: string[];
	written: string[];
}

export const NO_CHANGES: SettledChanges = { summaries: [], problems: [], written: [] };

export interface SiteChangeSource {
	name: string;
	/**
	 * The check saves to the site, as a fix it makes is saved. The checks that
	 * save run one at a time, in order, and the others then together, on the
	 * site the saves leave.
	 */
	saves?: boolean;
	/**
	 * The versions on a site now; the last ones read let a source reuse work.
	 * `host` is the app the agent runs in, for what Studio knows of the site.
	 */
	read( sitePath: string, last: Versions | undefined, host: StudioAgentHost ): Promise< Versions >;
	/** The changes from `before` to `after`, and the versions the next call is compared with. */
	check(
		site: HostSite,
		before: Versions,
		after: Versions,
		host: StudioAgentHost
	): Promise< { reports: ChangeReport[]; next?: Versions } >;
}

const SITE_CHANGE_SOURCES: SiteChangeSource[] = [
	// First, so the other checks read the Global Styles WordPress applies.
	globalStylesFlag,
	// Before the blocks are rendered, so a Jetpack block renders with its module.
	jetpackModules,
	// Before the blocks are validated, so the editor loads a block's script after the packages it reads.
	blockScriptAssets,
	// Before the posts, so a copy saved to its post is checked as the post.
	postCopies,
	postContentChanges,
	renderedBlocks,
	sectionLinks,
	linksToNowhereChanges,
	updatableThemeChanges,
	childThemeCopies,
	blockTheme,
	themeErrors,
	templatePartAreas,
	missingTemplateParts,
	themeStylesheet,
	siteFileWrites,
	adminCapabilities,
	blockEditorScripts,
	blockStyleClasses,
	themeLook,
];

export class SiteChanges {
	private readonly snapshots = new Map< string, Versions >();
	private snapshotting?: Promise< void >;

	constructor(
		private readonly host: StudioAgentHost,
		private readonly open?: OpenProblems,
		private readonly sites: () => Promise< HostSite[] > = () => host.sites.all(),
		private readonly sources: SiteChangeSource[] = SITE_CHANGE_SOURCES
	) {}

	/**
	 * Records each site it checks as it is now. Calls the model makes at once
	 * share one snapshot, as they start from the same sites.
	 */
	snapshot(): Promise< void > {
		this.snapshotting ??= this.read().finally( () => {
			this.snapshotting = undefined;
		} );
		return this.snapshotting;
	}

	private async read(): Promise< void > {
		await Promise.all(
			( await this.sites() ).map( async ( site ) => {
				await this.open?.see( site.path );
				await Promise.all(
					this.sources.map( async ( source ) => {
						const key = `${ source.name } ${ site.path }`;
						this.snapshots.set(
							key,
							await source.read( site.path, this.snapshots.get( key ), this.host )
						);
					} )
				);
			} )
		);
	}

	/** Checks what changed since the snapshot, and snapshots it. */
	async settle(): Promise< SettledChanges > {
		const sites = await this.sites();
		const reports = await Promise.all( sites.map( ( site ) => this.settleSite( site ) ) );
		const summaries: string[] = [];
		const problems: string[] = [];
		const written: string[] = [];
		// Reported by site and source, in their order, however the checks interleave.
		sites.forEach( ( site, i ) => {
			for ( const report of reports[ i ].flat() ) {
				this.open?.record( site.path, `${ site.path }#${ report.key }`, report.problem );
				summaries.push( ...( report.summary ? [ report.summary ] : [] ) );
				problems.push( ...( report.problem && ! report.atTurnEnd ? [ report.problem ] : [] ) );
				written.push( ...( report.written ? [ report.written ] : [] ) );
			}
		} );
		return { summaries, problems, written };
	}

	// Each source's reports on a site, in the sources' order.
	private async settleSite( site: HostSite ): Promise< ChangeReport[][] > {
		const settleSource = async ( source: SiteChangeSource ): Promise< ChangeReport[] > => {
			const key = `${ source.name } ${ site.path }`;
			const before = this.snapshots.get( key );
			const after = await source.read( site.path, before, this.host );
			// A site first seen now has no changes yet.
			const { reports, next } = before
				? await source.check( site, before, after, this.host )
				: { reports: [], next: undefined };
			this.snapshots.set( key, next ?? after );
			return reports;
		};
		const reports = new Map< SiteChangeSource, ChangeReport[] >();
		for ( const source of this.sources.filter( ( source ) => source.saves ) ) {
			reports.set( source, await settleSource( source ) );
		}
		await Promise.all(
			this.sources
				.filter( ( source ) => ! source.saves )
				.map( async ( source ) => reports.set( source, await settleSource( source ) ) )
		);
		return this.sources.map( ( source ) => reports.get( source ) ?? [] );
	}
}
