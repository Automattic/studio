import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { Button } from '@/lib/ui';
import { AccessView, type Access } from './access-control';
import type { useWpcomSiteVisibility } from '@/data/queries/use-wpcom-site-visibility';

export function HostedAccessView( {
	state,
	onBack,
}: {
	state: ReturnType< typeof useWpcomSiteVisibility >;
	onBack: () => void;
} ) {
	const [ draft, setDraft ] = useState< Exclude< Access, 'link' > >();
	const { query, save } = state;
	const value = draft ?? query.data?.visibility;
	const saving = save.isPending;
	return (
		<AccessView
			value={ value }
			onChange={ ( next ) => {
				save.reset();
				if ( next !== 'link' ) setDraft( next );
			} }
			hosted
			includePrivate={ query.data?.visibility === 'private' }
			disabled={ saving || ! query.data || query.isError }
			publicDescription={ __( 'Anyone can visit your site.' ) }
			publishDisabled={ ! value }
			onBack={ onBack }
			saving={ saving }
			doneVariant={ value && value !== query.data?.visibility ? 'accent' : 'outline' }
			doneLabel={
				saving ? __( 'Saving…' ) : value === query.data?.visibility ? __( 'Done' ) : __( 'Save' )
			}
			error={
				query.isError ? (
					<p role="alert">
						{ __( 'Couldn’t load site visibility.' ) }{ ' ' }
						<Button variant="inline-accent" size="inline" onClick={ () => void query.refetch() }>
							{ __( 'Try again' ) }
						</Button>
					</p>
				) : save.isError ? (
					<p role="alert">{ save.error.message }</p>
				) : undefined
			}
			onDone={ () => {
				if ( ! value || saving || query.isError || ! query.data ) return;
				if ( value === query.data.visibility ) {
					onBack();
					return;
				}
				save.mutate( value, { onSuccess: onBack } );
			} }
		/>
	);
}
