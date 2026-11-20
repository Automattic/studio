import {
	DEFAULT_COLOR_SCHEME,
	INTERFACE_PREFERENCE_DEFAULTS,
} from '@studio/common/lib/user-settings/preferences';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { resetPanelLayout } from '@/data/resizable-panels';
import { DEFAULT_COLOR_TINT } from '@/lib/theme';
import { useSetOnboardingHints } from './use-onboarding-hints';
import { useSaveUserPreferences } from './use-user-preferences';

export function useResetInterface() {
	const save = useSaveUserPreferences();
	const setHints = useSetOnboardingHints();
	const reset = () => {
		if ( save.isPending || setHints.isPending ) return;
		void save
			.mutateAsync( { ...INTERFACE_PREFERENCE_DEFAULTS } )
			.then( async () => {
				resetPanelLayout();
				await setHints.mutateAsync( { shareHintDismissed: false } );
				toast.success( __( 'Interface reset.' ) );
			} )
			.catch( () => toast.error( __( 'Could not reset interface. Please try again.' ) ) );
	};
	return { reset, isError: save.isError || setHints.isError };
}

export function useResetAppearance() {
	const save = useSaveUserPreferences();
	const reset = () => {
		if ( save.isPending ) return;
		save.mutate(
			{ ...DEFAULT_COLOR_TINT, colorScheme: DEFAULT_COLOR_SCHEME },
			{
				onSuccess: () => toast.success( __( 'Appearance reset.' ) ),
				onError: () => toast.error( __( 'Could not reset appearance. Please try again.' ) ),
			}
		);
	};
	return { reset, isError: save.isError };
}
