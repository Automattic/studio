import { ExternalLinkIcon, GlobeIcon, UsersIcon } from '@studio/ds/icons';
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
			icon={ <UsersIcon /> }
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
