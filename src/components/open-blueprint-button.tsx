import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { PROTOCOL_PREFIX } from 'common/constants';
import Button, { ButtonProps } from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';

type OpenBlueprintButtonProps = ButtonProps & {
	content: string;
};

export function OpenBlueprintButton( {
	content,
	children,
	icon = external,
	onClick,
	...props
}: OpenBlueprintButtonProps ) {
	return (
		<Button
			{ ...props }
			icon={ icon }
			onClick={ () => {
				const bytes = new TextEncoder().encode( content );
				const binString = Array.from( bytes, ( byte ) => String.fromCodePoint( byte ) ).join( '' );
				const base64 = btoa( binString );
				const url = `${ PROTOCOL_PREFIX }://add-site?blueprint=${ encodeURIComponent( base64 ) }`;
				getIpcApi().openURL( url );
			} }
		>
			{ children || __( 'Open in Studio' ) }
		</Button>
	);
}
