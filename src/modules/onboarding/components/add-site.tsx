import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { useAuth } from 'src/hooks/use-auth';
import AddSite from 'src/modules/add-site';

export function OnboardingAddSite( { onBack }: { onBack: () => void } ) {
	const { __ } = useI18n();
	const { isAuthenticated } = useAuth();

	return (
		<div className="h-full flex flex-col">
			<div className="flex flex-col items-center gap-6 my-auto">
				<AddSite withCtaButton={ false } />
			</div>
			{ ! isAuthenticated && (
				<div className="text-center">
					<Button onClick={ onBack }>
						{ '← ' }
						{ __( 'Connect WordPress.com' ) }
					</Button>
				</div>
			) }
		</div>
	);
}
