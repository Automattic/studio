import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import {
	getConnectFields,
	getProviderSites,
	type ProviderSites,
	type SitesProviderId,
} from '@studio/providers';
import { useMutation } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useId, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	Button,
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	Input,
} from '@/lib/ui';
import styles from './style.module.css';

// A site the user describes in the provider's `sites.connect` form, once the provider reached it.
export function ConnectSiteForm( {
	provider,
	siteId,
	disabled = false,
	onSite,
}: {
	provider: SitesProviderId;
	// The local site, when there is one yet.
	siteId?: string;
	disabled?: boolean;
	onSite: ( site: ProviderSites[ SitesProviderId ] ) => Promise< void > | void;
} ) {
	const connector = useConnector();
	const id = useId();
	const { intro, connect: method } = getProviderSites( provider );
	const fields = getConnectFields( method! );
	const [ values, setValues ] = useState< Record< string, string > >( {} );
	const connect = useMutation( {
		mutationFn: async () => {
			const site = await connector.resolveRemoteSite( provider, values ).catch( ( error ) => {
				void connector.trackEvent(
					TRACKS_EVENTS.SYNC_CONNECT,
					{
						success: false,
						sync_type: getSyncType( undefined, provider ),
						failure_reason: classifySyncFailure( error ),
					},
					siteId
				);
				throw error;
			} );
			await onSite( site );
		},
	} );
	const errors = fields.map( ( field ) =>
		values[ field.name ] ? field.validate( values[ field.name ] ) : undefined
	);
	const ready = fields.every(
		( field, index ) => ! errors[ index ] && ( ! field.required || values[ field.name ]?.trim() )
	);

	return (
		<form
			className={ styles.form }
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
