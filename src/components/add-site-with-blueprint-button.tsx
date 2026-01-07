import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';
import { PROTOCOL_PREFIX } from 'common/constants';
import Button, { ButtonProps } from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

type AddSiteWithBlueprintButtonProps = ButtonProps & {
	content: string;
};

function createBlueprintDeeplinkUrl( blueprintContent: string ): string {
	const bytes = new TextEncoder().encode( blueprintContent );
	const binString = Array.from( bytes, ( byte ) => String.fromCodePoint( byte ) ).join( '' );
	const base64 = btoa( binString );
	return `${ PROTOCOL_PREFIX }://add-site?blueprint=${ encodeURIComponent( base64 ) }`;
}

export function AddSiteWithBlueprintButton( {
	content,
	children,
	icon = plus,
	onClick,
	...props
}: AddSiteWithBlueprintButtonProps ) {
	return (
		<Button
			{ ...props }
			icon={ icon }
			onClick={ () => {
				const url = createBlueprintDeeplinkUrl( content );
				getIpcApi().openURL( url );
			} }
		>
			{ children || __( 'Add site from a Blueprint' ) }
		</Button>
	);
}
