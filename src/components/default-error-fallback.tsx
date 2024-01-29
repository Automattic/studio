import { __experimentalVStack as VStack } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import Button from './button';

export default function DefaultErrorFallback() {
	const { __ } = useI18n();

	return (
		<VStack alignment="center" justify="stretch" className="text-center bg-white text-black">
			<h1 className="text-2xl font-light">{ __( 'Something went wrong 😭' ) }</h1>
			<p className="max-w-md">
				{ createInterpolateElement(
					__(
						'Weʼve logged the issue to help us track down the problem. Reloading <i>might</i> help in the meantime.'
					),
					{
						i: <em />,
					}
				) }
			</p>
			<Button variant="secondary" onClick={ () => window.location.reload() }>
				{ __( 'Reload' ) }
			</Button>
		</VStack>
	);
}
