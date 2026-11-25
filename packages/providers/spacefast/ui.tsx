import { ExternalLinkIcon, GlobeIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { spaceDashboardUrl, type Space } from './descriptor';
import type { NewSiteRowsProps, ProviderUi, SiteRowsProps } from '../types';

function SpacefastSiteRows( { site, disabled, openUrl, Row }: SiteRowsProps< Space > ) {
	const url = spaceDashboardUrl( site );
	if ( ! url ) {
		return null;
	}
	return (
		<Row
			icon={ <GlobeIcon /> }
			label={ __( 'Add a domain' ) }
			trailing={ <ExternalLinkIcon /> }
			disabled={ disabled }
			onClick={ () => openUrl( `${ url }/domains/add` ) }
		/>
	);
}

function TeamIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
			<path d="M117.25,157.92a60,60,0,1,0-66.5,0A95.83,95.83,0,0,0,3.53,195.63a8,8,0,1,0,13.4,8.74,80,80,0,0,1,134.14,0,8,8,0,0,0,13.4-8.74A95.83,95.83,0,0,0,117.25,157.92ZM40,108a44,44,0,1,1,44,44A44.05,44.05,0,0,1,40,108Zm210.14,98.7a8,8,0,0,1-11.07-2.33A79.83,79.83,0,0,0,172,168a8,8,0,0,1,0-16,44,44,0,1,0-16.34-84.87,8,8,0,1,1-5.94-14.85,60,60,0,0,1,55.53,105.64,95.83,95.83,0,0,1,47.22,37.71A8,8,0,0,1,250.14,206.7Z" />
		</svg>
	);
}

// The team a new Space goes in, for an account with more than one. Without a choice, it goes in
// the first.
function SpacefastNewSiteRows( { input, disabled, onChange, run, SelectRow }: NewSiteRowsProps ) {
	const [ teams, setTeams ] = useState< { id: string; name: string }[] >( [] );

	useEffect( () => {
		let active = true;
		run( 'teams' ).then(
			( list ) => active && setTeams( list as { id: string; name: string }[] ),
			() => {}
		);
		return () => {
			active = false;
		};
	}, [ run ] );

	if ( teams.length < 2 ) {
		return null;
	}
	return (
		<SelectRow
			icon={ <TeamIcon /> }
			label={ __( 'Team' ) }
			value={ input.team ?? teams[ 0 ].id }
			options={ teams.map( ( { id, name } ) => ( { value: id, label: name } ) ) }
			disabled={ disabled }
			onChange={ ( team ) => onChange( { ...input, team } ) }
		/>
	);
}

export const spacefastUi: ProviderUi< Space > = {
	SiteRows: SpacefastSiteRows,
	NewSiteRows: SpacefastNewSiteRows,
};
