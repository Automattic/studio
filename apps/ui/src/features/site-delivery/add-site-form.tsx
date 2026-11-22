import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import { getFormFields, getProviderSites, type SitesProviderId } from '@studio/providers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useId, useState } from 'react';
import { useConnector } from '@/data/core';
import { remoteSitesQueryKey } from '@/data/queries/use-remote-sites';
import {
	Button,
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	Input,
} from '@/lib/ui';
import styles from './existing-site-step.module.css';

// Connects the local site to a site the user describes in the provider's `sites.add` form.
export function AddSiteForm( {
	provider,
	siteId,
	disabled,
	onConnected,
}: {
	provider: SitesProviderId;
	siteId: string;
	disabled: boolean;
	onConnected: ( provider: SitesProviderId, id: string | number ) => void;
} ) {
	const connector = useConnector();
	const client = useQueryClient();
	const id = useId();
	const { intro, add } = getProviderSites( provider );
	const fields = getFormFields( add!.input() );
	const [ values, setValues ] = useState< Record< string, string > >( {} );
	const connect = useMutation( {
		mutationFn: () => connector.addRemoteSite( provider, siteId, values ),
		onSuccess: async ( site ) => {
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_CONNECT,
				{ success: true, num_of_sites: 1, sync_type: getSyncType( site, provider ) },
				siteId
			);
			await Promise.all( [
				client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, siteId ) } ),
				client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider ) } ),
			] );
			onConnected( provider, site.id );
		},
		onError: ( error ) =>
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_CONNECT,
				{
					success: false,
					sync_type: getSyncType( undefined, provider ),
					failure_reason: classifySyncFailure( error ),
				},
				siteId
			),
	} );
	const errors = fields.map( ( field ) =>
		values[ field.name ] ? field.validate( values[ field.name ] ) : undefined
	);
	const ready = fields.every(
		( field, index ) => ! errors[ index ] && ( ! field.required || values[ field.name ]?.trim() )
	);

	return (
		<form
			className={ styles.body }
			aria-label={ intro.title() }
			onSubmit={ ( event ) => {
				event.preventDefault();
				if ( ready && ! connect.isPending ) connect.mutate();
			} }
		>
			<p>{ intro.description() }</p>
			<FieldGroup>
				{ fields.map( ( field, index ) => (
					<Field key={ field.name }>
						<FieldLabel htmlFor={ `${ id }-${ field.name }` }>{ field.title }</FieldLabel>
						<Input
							id={ `${ id }-${ field.name }` }
							autoComplete="off"
							spellCheck={ false }
							placeholder={ field.placeholder }
							value={ values[ field.name ] ?? '' }
							disabled={ disabled || connect.isPending }
							onChange={ ( event ) =>
								setValues( { ...values, [ field.name ]: event.target.value } )
							}
						/>
						<FieldDescription error={ errors[ index ] }>{ field.description }</FieldDescription>
					</Field>
				) ) }
			</FieldGroup>
			<FieldError>{ connect.error?.message }</FieldError>
			<Button
				type="submit"
				variant="accent"
				disabled={ disabled || ! ready }
				loading={ connect.isPending }
				loadingAnnouncement={ __( 'Connecting' ) }
			>
				{ __( 'Connect' ) }
			</Button>
		</form>
	);
}
