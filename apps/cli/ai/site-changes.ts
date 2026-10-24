/**
 * What a call changed on the sites, checked where WordPress reads it, not on
 * the way there: content reaches a post by WP-CLI, `wp eval`, REST or an
 * import, and a theme's files by any tool or script.
 *
 * Surfaces take a snapshot before a call and settle after it, so what a call
 * changed is reported on that call's result. Each source reads one kind of
 * thing WordPress reads, as versions a check compares.
 */
import { childThemeCopies } from 'cli/ai/child-theme-copies';
import { postContentChanges } from 'cli/ai/post-content-check';
import { updatableThemeChanges } from 'cli/ai/theme-file-changes';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import type { OpenProblems } from 'cli/ai/open-problems';

/** Each thing's version on a site, by key. */
export type Versions = Record< string, string >;

/** What a change means: a line for the result, and the problem it leaves, if any. */
export interface ChangeReport {
	key: string;
	summary?: string;
	problem?: string;
}

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
	postContentChanges,
	updatableThemeChanges,
	childThemeCopies,
];

async function localSites(): Promise< SiteData[] > {
	return ( await readCliConfig() ).sites;
}

export class SiteChanges {
	constructor(
		private readonly snapshots = new Map< string, Versions >(),
		private readonly open?: OpenProblems,
		private readonly sites: () => Promise< SiteData[] > = localSites,
		private readonly sources: SiteChangeSource[] = SITE_CHANGE_SOURCES
	) {}

	/** Records every local site as it is now. */
	async snapshot(): Promise< void > {
		for ( const site of await this.sites() ) {
			for ( const source of this.sources ) {
				const key = `${ source.name } ${ site.path }`;
				this.snapshots.set( key, await source.read( site.path, this.snapshots.get( key ) ) );
			}
		}
	}

	/** Checks what changed since the snapshot, and snapshots it. */
	async settle(): Promise< { summaries: string[]; problems: string[] } > {
		const summaries: string[] = [];
		const problems: string[] = [];
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
					problems.push( ...( report.problem ? [ report.problem ] : [] ) );
				}
			}
		}
		return { summaries, problems };
	}
}
