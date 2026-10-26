/**
 * What a call changed on the sites, checked where WordPress reads it, not on
 * the way there: content reaches a post by WP-CLI, `wp eval`, REST or an
 * import, and a theme's files by any tool or script.
 *
 * Surfaces take a snapshot before a call and settle after it, so what a call
 * changed is reported on that call's result. Each source reads one kind of
 * thing WordPress reads, as versions a check compares.
 */
import { adminCapabilities } from 'cli/ai/admin-capabilities';
import { renderedBlocks } from 'cli/ai/block-render-check';
import { blockTheme } from 'cli/ai/block-theme';
import { childThemeCopies } from 'cli/ai/child-theme-copies';
import { postContentChanges } from 'cli/ai/post-content-check';
import { postCopies } from 'cli/ai/post-copies';
import { siteFileWrites } from 'cli/ai/site-file-writes';
import { templatePartAreas } from 'cli/ai/template-part-areas';
import { themeErrors } from 'cli/ai/theme-errors';
import { updatableThemeChanges } from 'cli/ai/theme-file-changes';
import { themeStylesheet } from 'cli/ai/theme-stylesheet';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import type { OpenProblems } from 'cli/ai/open-problems';

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
	/** The versions on a site now; the last ones read let a source reuse work. */
	read( sitePath: string, last?: Versions ): Promise< Versions >;
	/** The changes from `before` to `after`, and the versions the next call is compared with. */
	check(
		site: SiteData,
		before: Versions,
		after: Versions
	): Promise< { reports: ChangeReport[]; next?: Versions } >;
}

export const SITE_CHANGE_SOURCES: SiteChangeSource[] = [
	// Before the posts, so a copy saved to its post is checked as the post.
	postCopies,
	postContentChanges,
	// After postContentChanges, which may save the editor's save of a post.
	renderedBlocks,
	updatableThemeChanges,
	childThemeCopies,
	blockTheme,
	themeErrors,
	templatePartAreas,
	// Before siteFileWrites, which reports the functions.php it may add to.
	themeStylesheet,
	siteFileWrites,
	adminCapabilities,
];

async function localSites(): Promise< SiteData[] > {
	return ( await readCliConfig() ).sites;
}

export class SiteChanges {
	private readonly snapshots = new Map< string, Versions >();

	constructor(
		private readonly open?: OpenProblems,
		private readonly sites: () => Promise< SiteData[] > = localSites,
		private readonly sources: SiteChangeSource[] = SITE_CHANGE_SOURCES
	) {}

	/** Records each site it checks as it is now. */
	async snapshot(): Promise< void > {
		for ( const site of await this.sites() ) {
			await this.open?.see( site.path );
			for ( const source of this.sources ) {
				const key = `${ source.name } ${ site.path }`;
				this.snapshots.set( key, await source.read( site.path, this.snapshots.get( key ) ) );
			}
		}
	}

	/** Checks what changed since the snapshot, and snapshots it. */
	async settle(): Promise< SettledChanges > {
		const summaries: string[] = [];
		const problems: string[] = [];
		const written: string[] = [];
		for ( const site of await this.sites() ) {
			for ( const source of this.sources ) {
				const key = `${ source.name } ${ site.path }`;
				const before = this.snapshots.get( key );
				const after = await source.read( site.path, before );
				// A site first seen now has no changes yet.
				const { reports, next } = before
					? await source.check( site, before, after )
					: { reports: [], next: undefined };
				this.snapshots.set( key, next ?? after );
				for ( const report of reports ) {
					this.open?.record( site.path, `${ site.path }#${ report.key }`, report.problem );
					summaries.push( ...( report.summary ? [ report.summary ] : [] ) );
					problems.push( ...( report.problem && ! report.atTurnEnd ? [ report.problem ] : [] ) );
					written.push( ...( report.written ? [ report.written ] : [] ) );
				}
			}
		}
		return { summaries, problems, written };
	}
}
