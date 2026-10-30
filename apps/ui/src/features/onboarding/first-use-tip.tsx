import { useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { FeaturePopover, Popover, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import { useOnboardingGuide } from './onboarding-guide/use-onboarding-guide';
import { useRootDialogOpen } from './onboarding-guide/use-root-dialog-open';

export function FirstUseTip( {
	children,
	enabled,
	tooltip,
	dismissalKey,
	title,
	description,
	illustration,
}: {
	children: ReactElement;
	enabled: boolean;
	tooltip: string;
	dismissalKey: 'annotateHintDismissed';
	title: string;
	description: string;
	illustration?: ReactNode;
} ) {
	const { data: hints } = useOnboardingHints();
	const setHints = useSetOnboardingHints();
	const { isOpen: guideOpen } = useOnboardingGuide();
	const dialogOpen = useRootDialogOpen();
	const eligible =
		enabled && hints !== undefined && ! hints[ dismissalKey ] && ! guideOpen && ! dialogOpen;
	const [ open, setOpen ] = useState( false );
	const triggerId = useId();
	const descriptionId = useId();
	useEffect( () => {
		if ( ! eligible ) setOpen( false );
	}, [ eligible ] );

	function dismiss() {
		setOpen( false );
		if ( eligible ) {
			setHints.mutate( { [ dismissalKey ]: true } );
		}
	}

	return (
		<Popover.Root
			open={ eligible && open }
			triggerId={ triggerId }
			onOpenChange={ ( nextOpen, details ) => {
				if ( details.reason === 'trigger-press' ) return;
				if ( details.reason === 'escape-key' ) {
					dismiss();
					return;
				}
				setOpen( nextOpen && eligible );
			} }
		>
			<Tooltip disabled={ eligible }>
				<TooltipTrigger
					render={
						<Popover.Trigger
							id={ triggerId }
							openOnHover={ eligible }
							delay={ 0 }
							closeDelay={ 150 }
							aria-describedby={ eligible && open ? descriptionId : undefined }
							aria-haspopup={ eligible ? 'dialog' : undefined }
							onFocus={ () => setOpen( eligible ) }
							onClick={ dismiss }
							render={ children }
						/>
					}
				/>
				<TooltipContent side="bottom">{ tooltip }</TooltipContent>
			</Tooltip>
			<FeaturePopover.Popup
				side="bottom"
				align="end"
				initialFocus={ false }
				finalFocus={ false }
				title={ title }
				description={ description }
				descriptionId={ descriptionId }
				illustration={ illustration }
			/>
		</Popover.Root>
	);
}
