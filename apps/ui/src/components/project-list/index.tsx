import { Link, useParams } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { moreHorizontal, plus } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const UNASSIGNED_KEY = '__unassigned__';

type ProjectGroup = {
	key: string;
	site?: SiteDetails;
	label: string;
	subtitle?: string;
	sessions: AiSessionSummary[];
};

function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

function deriveSubtitle( site: SiteDetails ): string | undefined {
	if ( site.url ) {
		return stripProtocol( site.url );
	}
	const basename = site.path.split( /[\\/]/ ).filter( Boolean ).pop();
	return basename;
}

function groupSessionsByOwner(
	sites: SiteDetails[] | undefined,
	sessions: AiSessionSummary[] | undefined
): ProjectGroup[] {
	const knownSitePaths = new Set( ( sites ?? [] ).map( ( site ) => site.path ) );
	const sessionsByPath = new Map< string, AiSessionSummary[] >();
	const unassigned: AiSessionSummary[] = [];

	for ( const session of sessions ?? [] ) {
		if ( ! session.ownerSitePath || ! knownSitePaths.has( session.ownerSitePath ) ) {
			unassigned.push( session );
			continue;
		}

		const existing = sessionsByPath.get( session.ownerSitePath );
		if ( existing ) {
			existing.push( session );
		} else {
			sessionsByPath.set( session.ownerSitePath, [ session ] );
		}
	}

	const groups: ProjectGroup[] = ( sites ?? [] ).map( ( site ) => ( {
		key: site.id,
		site,
		label: site.name,
		subtitle: deriveSubtitle( site ),
		sessions: sessionsByPath.get( site.path ) ?? [],
	} ) );

	// Sort site-groups by the newest session's updatedAt so the most recently
	// used project lands at the top. Projects with no sessions drop to the bottom.
	groups.sort( ( a, b ) => {
		const aTimestamp = a.sessions[ 0 ]?.updatedAt;
		const bTimestamp = b.sessions[ 0 ]?.updatedAt;
		if ( ! aTimestamp && ! bTimestamp ) {
			return 0;
		}
		if ( ! aTimestamp ) {
			return 1;
		}
		if ( ! bTimestamp ) {
			return -1;
		}
		return Date.parse( bTimestamp ) - Date.parse( aTimestamp );
	} );

	if ( unassigned.length > 0 ) {
		groups.push( {
			key: UNASSIGNED_KEY,
			label: __( 'Unassigned' ),
			sessions: unassigned,
		} );
	}

	return groups;
}

function SessionItem( { session }: { session: AiSessionSummary } ) {
	const label = session.firstPrompt?.trim() || __( '(No prompt yet)' );

	return (
		<li className={ styles.sessionItem }>
			<Link
				to="/sessions/$sessionId"
				params={ { sessionId: session.id } }
				className={ styles.sessionLink }
				activeProps={ { className: clsx( styles.sessionLink, styles.sessionLinkActive ) } }
			>
				<span className={ styles.sessionLabel }>{ label }</span>
				<span className={ styles.sessionTime }>{ formatRelativeTime( session.updatedAt ) }</span>
			</Link>
		</li>
	);
}

function ProjectSection( {
	group,
	isUnassigned,
	isActive,
	isOpen,
	onToggle,
}: {
	group: ProjectGroup;
	isUnassigned: boolean;
	isActive: boolean;
	isOpen: boolean;
	onToggle: () => void;
} ) {
	return (
		<section
			className={ clsx(
				styles.project,
				isUnassigned && styles.unassigned,
				isActive && styles.projectActive
			) }
		>
			<header className={ styles.projectHeader }>
				<div className={ styles.projectText }>
					<button
						type="button"
						className={ styles.projectToggle }
						onClick={ onToggle }
						aria-expanded={ isOpen }
					>
						<span className={ styles.projectName }>{ group.label }</span>
					</button>
					{ group.subtitle ? (
						<span className={ styles.projectSubtitle }>{ group.subtitle }</span>
					) : null }
				</div>
				{ group.site ? (
					<div className={ styles.projectActions }>
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ moreHorizontal }
							label={ __( 'Project actions' ) }
							className={ styles.projectAction }
						/>
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ plus }
							label={ __( 'New session' ) }
							className={ styles.projectAction }
						/>
					</div>
				) : null }
			</header>
			{ isOpen && group.sessions.length > 0 ? (
				<ul className={ styles.sessionList }>
					{ group.sessions.map( ( session ) => (
						<SessionItem key={ session.id } session={ session } />
					) ) }
				</ul>
			) : null }
		</section>
	);
}

function findActiveProjectKey(
	groups: ProjectGroup[],
	activeSessionId: string | undefined
): string | undefined {
	if ( ! activeSessionId ) {
		return undefined;
	}
	for ( const group of groups ) {
		if ( group.sessions.some( ( session ) => session.id === activeSessionId ) ) {
			return group.key;
		}
	}
	return undefined;
}

export function ProjectList() {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const params = useParams( { strict: false } ) as { sessionId?: string };
	const activeSessionId = params.sessionId;

	const groups = useMemo( () => groupSessionsByOwner( sites, sessions ), [ sites, sessions ] );
	const activeProjectKey = useMemo(
		() => findActiveProjectKey( groups, activeSessionId ),
		[ groups, activeSessionId ]
	);

	// Expansion is derived: by default the active project (or, if none, the
	// MRU project — first in the list) is open. Manual toggles are stored as
	// overrides so the user's explicit choice wins until they toggle again.
	const mruKey = groups[ 0 ]?.key;
	const [ overrides, setOverrides ] = useState< Record< string, boolean > >( {} );

	const isOpen = ( key: string ): boolean => {
		if ( key in overrides ) {
			return overrides[ key ];
		}
		return key === activeProjectKey || ( ! activeProjectKey && key === mruKey );
	};

	const toggleProject = ( key: string ) => {
		setOverrides( ( prev ) => ( { ...prev, [ key ]: ! isOpen( key ) } ) );
	};

	return (
		<div className={ styles.root }>
			{ sitesLoading || sessionsLoading ? (
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			) : groups.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No projects yet' ) }</p>
			) : (
				<div className={ styles.projects }>
					{ groups.map( ( group ) => (
						<ProjectSection
							key={ group.key }
							group={ group }
							isUnassigned={ group.key === UNASSIGNED_KEY }
							isActive={ group.key === activeProjectKey }
							isOpen={ isOpen( group.key ) }
							onToggle={ () => toggleProject( group.key ) }
						/>
					) ) }
				</div>
			) }
		</div>
	);
}
