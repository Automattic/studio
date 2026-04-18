import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronDown, chevronRight, plus } from '@wordpress/icons';
import { Button, Collapsible, IconButton, Stack } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const UNASSIGNED_KEY = '__unassigned__';

type ProjectGroup = {
	key: string;
	site?: SiteDetails;
	label: string;
	sessions: AiSessionSummary[];
};

function groupSessionsByOwner(
	sites: SiteDetails[] | undefined,
	sessions: AiSessionSummary[] | undefined
): ProjectGroup[] {
	const knownSitePaths = new Set( ( sites ?? [] ).map( ( site ) => site.path ) );
	const sessionsByPath = new Map< string, AiSessionSummary[] >();
	const unassigned: AiSessionSummary[] = [];

	for ( const session of sessions ?? [] ) {
		// A session is "assigned" only if its owner path still matches a known site.
		// Orphans (site deleted/renamed, empty path, or never selected one) fall through
		// to the Unassigned bucket so they stay reachable.
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
		sessions: sessionsByPath.get( site.path ) ?? [],
	} ) );

	// Sort site-groups by the newest session's updatedAt so the most recently
	// used project lands at the top (and gets expanded on launch). Sessions are
	// already sorted newest-first, so sessions[0] is each project's MRU. Projects
	// with no sessions drop to the bottom.
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
				activeProps={ { className: `${ styles.sessionLink } ${ styles.sessionLinkActive }` } }
			>
				{ label }
			</Link>
		</li>
	);
}

function ProjectSection( {
	group,
	defaultOpen,
	isUnassigned,
}: {
	group: ProjectGroup;
	defaultOpen: boolean;
	isUnassigned: boolean;
} ) {
	const [ open, setOpen ] = useState( defaultOpen );

	return (
		<Collapsible.Root
			open={ open }
			onOpenChange={ setOpen }
			className={ `${ styles.project } ${ isUnassigned ? styles.unassigned : '' }` }
		>
			<div className={ styles.projectRow }>
				<Collapsible.Trigger
					render={
						<Button
							variant="minimal"
							tone="neutral"
							size="compact"
							className={ styles.projectTrigger }
						>
							<Button.Icon icon={ open ? chevronDown : chevronRight } size={ 16 } />

							<span className={ styles.projectName }>{ group.label }</span>
						</Button>
					}
				/>
				{ group.site ? (
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ plus }
						label={ __( 'New session' ) }
						className={ styles.projectAction }
					/>
				) : null }
			</div>
			<Collapsible.Panel>
				{ group.sessions.length === 0 ? (
					<p className={ styles.empty }>{ __( 'No sessions' ) }</p>
				) : (
					<ul className={ styles.sessionList }>
						{ group.sessions.map( ( session ) => (
							<SessionItem key={ session.id } session={ session } />
						) ) }
					</ul>
				) }
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

export function ProjectList() {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();

	const groups = useMemo( () => groupSessionsByOwner( sites, sessions ), [ sites, sessions ] );

	return (
		<div className={ styles.root }>
			<Stack direction="row" align="center" justify="flex-end" className={ styles.header }>
				<Button variant="minimal" tone="neutral" size="compact">
					<Button.Icon icon={ plus } size={ 16 } />
					<span>{ __( 'Add site' ) }</span>
				</Button>
			</Stack>
			{ sitesLoading || sessionsLoading ? (
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			) : groups.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No projects yet' ) }</p>
			) : (
				<div className={ styles.projects }>
					{ groups.map( ( group, index ) => {
						const isUnassigned = group.key === UNASSIGNED_KEY;
						return (
							<ProjectSection
								key={ group.key }
								group={ group }
								isUnassigned={ isUnassigned }
								defaultOpen={
									! isUnassigned && index === 0 && group.sessions.length > 0
								}
							/>
						);
					} ) }
				</div>
			) }
		</div>
	);
}
