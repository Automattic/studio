import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Icon, chevronDown, chevronRight, plus } from '@wordpress/icons';
import { Button, Collapsible, Stack } from '@wordpress/ui';
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
	const sessionsByPath = new Map< string, AiSessionSummary[] >();
	const unassigned: AiSessionSummary[] = [];

	for ( const session of sessions ?? [] ) {
		if ( ! session.ownerSitePath ) {
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

function ProjectSection( { group, defaultOpen }: { group: ProjectGroup; defaultOpen: boolean } ) {
	const [ open, setOpen ] = useState( defaultOpen );

	return (
		<Collapsible.Root open={ open } onOpenChange={ setOpen } className={ styles.project }>
			<Stack direction="row" align="center" justify="space-between">
				<Collapsible.Trigger
					render={
						<Button variant="minimal" tone="neutral" size="compact">
							<Icon icon={ open ? chevronDown : chevronRight } size={ 18 } />
							<span className={ styles.projectName }>{ group.label }</span>
						</Button>
					}
				/>
				{ group.site ? (
					<Button
						variant="minimal"
						tone="neutral"
						size="compact"
						aria-label={ __( 'New session' ) }
					>
						<Icon icon={ plus } size={ 18 } />
					</Button>
				) : null }
			</Stack>
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
			<Stack direction="row" align="center" justify="space-between" className={ styles.header }>
				<span className={ styles.title }>{ __( 'Projects' ) }</span>
				<Button variant="minimal" tone="neutral" size="compact">
					<Icon icon={ plus } size={ 18 } />
					<span>{ __( 'Add site' ) }</span>
				</Button>
			</Stack>
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
							defaultOpen={ group.sessions.length > 0 }
						/>
					) ) }
				</div>
			) }
		</div>
	);
}
