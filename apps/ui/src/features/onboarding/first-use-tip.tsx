import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { FeaturePopover, Popover, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';
import { useOnboardingGuide } from './onboarding-guide/use-onboarding-guide';
import { useRootDialogOpen } from './onboarding-guide/use-root-dialog-open';
import { isWalkthroughPending } from './walkthrough';

export function FirstUseTip( {
	children,
	enabled,
	active,
	tooltip,
	dismissalKey,
	title,
	description,
}: {
	children: ReactElement;
	enabled: boolean;
	active: boolean;
	tooltip: ReactNode;
	dismissalKey: 'annotateHintDismissed';
	title: string;
	description: string;
} ) {
	const { data: hints } = useOnboardingHints();
	const { mutate: markSeen } = useSetOnboardingHints();
	const { isOpen: guideOpen } = useOnboardingGuide();
	const dialogOpen = useRootDialogOpen();
	const eligible =
		enabled &&
		hints !== undefined &&
		! isWalkthroughPending( hints.walkthroughStep ) &&
		! hints[ dismissalKey ] &&
		! guideOpen &&
		! dialogOpen;
	const [ open, setOpen ] = useState( false );
	const triggerId = useId();
	const descriptionId = useId();
	const presented = useRef( false );
	useEffect( () => {
		if ( ! active ) presented.current = false;
		if ( ! active || ! enabled || guideOpen || dialogOpen ) {
			setOpen( false );
			return;
		}
		if ( ! eligible || presented.current ) return;
		presented.current = true;
		setOpen( true );
		markSeen( { [ dismissalKey ]: true } );
	}, [ active, enabled, eligible, guideOpen, dialogOpen, dismissalKey, markSeen ] );
	const visible =
		open &&
		active &&
		enabled &&
		! isWalkthroughPending( hints?.walkthroughStep ) &&
		! guideOpen &&
		! dialogOpen;
	const dismiss = () => setOpen( false );

	return (
		<Popover.Root
			open={ visible }
			triggerId={ triggerId }
			onOpenChange={ ( nextOpen, details ) => {
				if ( details.reason === 'trigger-press' ) return;
				if ( ! nextOpen ) dismiss();
			} }
		>
			<Tooltip disabled={ visible || isWalkthroughPending( hints?.walkthroughStep ) }>
				<TooltipTrigger
					render={
						<Popover.Trigger
							id={ triggerId }
							aria-describedby={ visible ? descriptionId : undefined }
							aria-haspopup={ visible ? 'dialog' : undefined }
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
				onDismiss={ dismiss }
				sideOffset={ 10 }
			/>
		</Popover.Root>
	);
}
