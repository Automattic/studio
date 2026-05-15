import { __ } from '@wordpress/i18n';
import { category } from '@wordpress/icons';
import { useSites } from '@/data/queries/use-sites';
import { Button } from '@/ui-desks/components';

interface DeskSiteMapButtonProps {
	siteId: string;
	open: boolean;
	onToggle: () => void;
}

export function DeskSiteMapButton( { siteId, open, onToggle }: DeskSiteMapButtonProps ) {
	const { data: sites, isLoading } = useSites();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const canOpen = Boolean( site?.running );
	const disabled = ! open && ( isLoading || ! canOpen );

	return (
		<Button
			icon={ category }
			label={ __( 'Site map' ) }
			tooltipLabel={ getTooltipLabel( isLoading, Boolean( site ), canOpen ) }
			aria-pressed={ open }
			disabled={ disabled }
			onClick={ onToggle }
		/>
	);
}

function getTooltipLabel( isLoading: boolean, hasSite: boolean, canOpen: boolean ) {
	if ( isLoading ) {
		return __( 'Checking site…' );
	}

	if ( ! hasSite ) {
		return __( 'Site map unavailable' );
	}

	if ( ! canOpen ) {
		return __( 'Start the site to view its site map' );
	}

	return __( 'Site map' );
}
