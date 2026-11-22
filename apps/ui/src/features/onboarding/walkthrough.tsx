import { useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { useWalkthroughTracking } from '@/data/walkthrough-analytics';
import { walkthroughPromptSenders } from '@/data/walkthrough-prompt';
import { FeaturePopover } from '@/lib/ui';
import { useOnboardingGuide } from './onboarding-guide/use-onboarding-guide';
import { WHATS_NEW_VERSION } from './onboarding-guide/whats-new';
import { GETTING_STARTED_REPLAY_EVENT, useOpenGettingStarted } from './use-open-getting-started';
import type { OnboardingHintsState } from '@/data/core';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

type Step = NonNullable< OnboardingHintsState[ 'walkthroughStep' ] >;
const ANNOTATE_TARGET = '[data-walkthrough~="annotate"]:not(:disabled, [aria-disabled="true"])';

type CreateStage = 'gallery' | 'details' | 'setup';
type GalleryStep = 'fresh' | 'design';

function getStep(
	step: Step,
	createStage: CreateStage,
	galleryStep: GalleryStep,
	sidebarClosed: boolean
) {
	switch ( step ) {
		case 'intro':
			return {
				title: sidebarClosed ? __( 'Open the sidebar' ) : __( 'Add a new site' ),
				description: sidebarClosed
					? __( 'Your sites live here. Open the sidebar to explore ways to add a new site.' )
					: __(
							'Start from scratch, try a design, or bring an existing site into WordPress Studio. You can explore without creating another site.'
					  ),
				action: sidebarClosed ? __( 'Show sidebar' ) : __( 'Next' ),
				next: 'create' as const,
			};
		case 'create':
			if ( createStage === 'setup' ) return null;
			return {
				title:
					createStage === 'gallery'
						? galleryStep === 'fresh'
							? __( 'Start from scratch' )
							: __( 'Start with a design' )
						: __( 'Make it yours' ),
				description:
					createStage === 'details'
						? __( 'Start with this design, then tell WordPress Studio what you’d like to change.' )
						: galleryStep === 'fresh'
						? __(
								'A blank WordPress site, ready to become whatever you have in mind. Already have a site? Connect it or import a backup.'
						  )
						: __(
								'You can also start with one of these designs. Change anything you like, from the words and photos to the layout.'
						  ),
				action:
					createStage === 'gallery'
						? galleryStep === 'fresh'
							? __( 'Next' )
							: __( 'Browse designs' )
						: __( 'Start with this site' ),
				next: 'composer' as const,
			};
		case 'composer':
			return {
				title: __( 'Chat with your site' ),
				description: __(
					'Say what you want in plain words. Add a page, swap the colors, fix the thing that’s bugging you.'
				),
				action: __( 'Next' ),
				next: 'publish' as const,
			};
		case 'annotate':
			return {
				title: __( 'Point to what you want to change' ),
				description: __(
					'Click an element, select an area, or draw right on the page. Add a note about what you’d like to change.'
				),
				action: __( 'Next' ),
				next: 'publish' as const,
			};
		case 'publish':
			return {
				title: __( 'Publish your WordPress' ),
				description: __(
					'Share a preview to get feedback, or publish your site so anyone can discover it.'
				),
				action: __( 'Done' ),
				next: 'completed' as const,
			};
		case 'try-chat':
			return {
				title: __( 'Ask what’s possible' ),
				description: __( 'Send a message to get ideas for making this site yours.' ),
				action: __( 'Send message' ),
				next: 'completed' as const,
			};

		default:
			return null;
	}
}

function isAvailable( element: HTMLElement ): boolean {
	for ( let node: HTMLElement | null = element; node; node = node.parentElement ) {
		if (
			node.hidden ||
			node.hasAttribute( 'inert' ) ||
			node.getAttribute( 'aria-hidden' ) === 'true' ||
			getComputedStyle( node ).display === 'none' ||
			getComputedStyle( node ).visibility === 'hidden'
		)
			return false;
	}
	return true;
}

function getFocusTarget( anchor: HTMLElement | null ): HTMLElement | null | undefined {
	const dialog = anchor?.closest( '[role="dialog"]' );
	if ( anchor instanceof HTMLButtonElement && anchor.disabled ) {
		return (
			dialog?.querySelector< HTMLElement >( '[aria-invalid="true"]' ) ??
			dialog?.querySelector< HTMLElement >( 'input:not([disabled])' )
		);
	}
	if ( anchor?.matches( 'button, input, textarea, [tabindex]' ) ) return anchor;
	return (
		Array.from(
			anchor?.querySelectorAll< HTMLElement >(
				'textarea:not([disabled]), input:not([disabled]), [contenteditable="true"], button:not([disabled])'
			) ?? []
		).find(
			( element ) => element.getAttribute( 'aria-disabled' ) !== 'true' && isAvailable( element )
		) ?? dialog?.querySelector< HTMLElement >( '[data-start-blank]' )
	);
}

export function Walkthrough( {
	inSiteDialog = false,
	createStage = 'gallery',
	onContinue,
}: {
	inSiteDialog?: boolean;
	createStage?: CreateStage;
	onContinue?: () => void;
} ) {
	const connector = useConnector();
	const { open: openGettingStarted } = useOpenGettingStarted();
	const { data: hints } = useOnboardingHints();
	const { mutate: setHints } = useSetOnboardingHints();
	const { data: sites } = useSites();
	const descriptionId = useId();
	const [ target, setTarget ] = useState< {
		element: HTMLElement | null;
		nextElement?: HTMLElement | null;
		title?: string;
		reason?: string;
		description?: string;
	} >( { element: null } );
	const anchor = target.element;
	const [ popoverHost, setPopoverHost ] = useState< {
		anchor: HTMLElement;
		element: HTMLElement;
	} | null >( null );
	const [ galleryStep, setGalleryStep ] = useState< GalleryStep >( 'fresh' );
	const [ revealedAnchor, setRevealedAnchor ] = useState< HTMLElement | null >( null );
	const showNextImmediately = useRef( false );
	const focusNextAnchor = useRef( false );
	const [ dismissedCreateStages, setDismissedCreateStages ] = useState< CreateStage[] >( [] );
	const [ suspended, setSuspended ] = useState( false );
	const [ composerBlocked, setComposerBlocked ] = useState( false );
	const { welcome, settings, addSite } = useSearch( { strict: false } ) as {
		welcome?: true;
		settings?: string;
		addSite?: string;
	};
	const { isOpen: guideOpen } = useOnboardingGuide();
	const step = hints?.walkthroughStep;
	const whatsNewSeenVersion = Math.max( hints?.whatsNewSeenVersion ?? 0, WHATS_NEW_VERSION );
	const sidebarClosed = step === 'intro' && !! anchor?.hasAttribute( 'data-sidebar-toggle' );
	const matchesPlacement = inSiteDialog ? step === 'create' : step !== 'create';
	const content =
		step && matchesPlacement ? getStep( step, createStage, galleryStep, sidebarClosed ) : null;
	const hasContent = content !== null;
	const targetStep =
		step === 'create'
			? createStage === 'details'
				? 'create-blueprint'
				: galleryStep === 'design'
				? 'create-design'
				: step
			: step;
	const blocked =
		!! welcome ||
		!! settings ||
		guideOpen ||
		( step === 'create' ? ! addSite : !! addSite || ! sites?.length );
	useEffect( () => {
		const reset = () => {
			setDismissedCreateStages( [] );
			setGalleryStep( 'fresh' );
			showNextImmediately.current = false;
			focusNextAnchor.current = false;
		};
		window.addEventListener( GETTING_STARTED_REPLAY_EVENT, reset );
		const unsubscribe = connector.onShowGettingStarted( () => {
			if ( inSiteDialog ) return;
			void openGettingStarted().catch( () =>
				toast.error( __( 'Could not start the tour. Please try again.' ) )
			);
		} );
		return () => {
			window.removeEventListener( GETTING_STARTED_REPLAY_EVENT, reset );
			unsubscribe();
		};
	}, [ connector, openGettingStarted, inSiteDialog ] );

	useEffect( () => {
		if ( inSiteDialog ) return;
		if ( step === 'intro' && addSite ) {
			setHints( { walkthroughStep: 'create' } );
		}
		if ( step === 'create' && sites?.length && ! welcome && ! addSite ) {
			setHints( { walkthroughStep: 'composer', whatsNewSeenVersion } );
		}
		if ( step === 'share' ) setHints( { walkthroughStep: 'publish' } );
	}, [ step, sites?.length, welcome, addSite, setHints, inSiteDialog, whatsNewSeenVersion ] );

	useEffect( () => {
		if ( ! hasContent || blocked ) {
			setTarget( ( current ) => ( current.element ? { element: null } : current ) );
			return;
		}
		const findTarget = () => {
			const target =
				Array.from(
					document.querySelectorAll< HTMLElement >(
						targetStep === 'annotate' ? ANNOTATE_TARGET : `[data-walkthrough~="${ targetStep }"]`
					)
				).find( isAvailable ) ??
				( step === 'intro'
					? Array.from( document.querySelectorAll< HTMLElement >( '[data-sidebar-toggle]' ) ).find(
							isAvailable
					  )
					: undefined );
			if (
				step === 'annotate' &&
				! target &&
				Array.from(
					document.querySelectorAll< HTMLElement >( '[data-walkthrough~="publish"]' )
				).some( isAvailable )
			) {
				setHints( { walkthroughStep: 'publish' } );
				return;
			}
			const nextSelector =
				targetStep === 'create'
					? '[data-walkthrough~="create-design"]'
					: step === 'publish'
					? '[data-walkthrough~="try-chat"]'
					: null;
			const nextElement = nextSelector
				? Array.from( document.querySelectorAll< HTMLElement >( nextSelector ) ).find(
						isAvailable
				  ) ?? null
				: null;
			const title = target?.dataset.walkthroughTitle;
			const reason = target?.dataset.walkthroughReason;
			const description = target?.dataset.walkthroughDescription;
			setTarget( ( current ) =>
				current.element === ( target ?? null ) &&
				current.nextElement === nextElement &&
				current.title === title &&
				current.reason === reason &&
				current.description === description
					? current
					: { element: target ?? null, nextElement, title, reason, description }
			);
			setComposerBlocked( !! document.querySelector( '[data-walkthrough-blocked="true"]' ) );
			const otherSurface = Array.from(
				document.querySelectorAll< HTMLElement >(
					'[data-slot="dialog-content"][data-open], [data-slot="popover-content"][data-open], [role="menu"][data-open]'
				)
			).some(
				( element ) =>
					element.getAttribute( 'aria-describedby' ) !== descriptionId &&
					! ( step === 'intro' && target && element.contains( target ) ) &&
					( ! inSiteDialog || element !== target?.closest( '[data-slot="dialog-content"]' ) )
			);
			setSuspended(
				otherSurface ||
					!! document.querySelector(
						'[data-walkthrough~="annotate"][aria-pressed="true"], [data-walkthrough~="annotate"] [aria-pressed="true"]'
					)
			);
		};
		findTarget();
		const observer = new MutationObserver( findTarget );
		observer.observe( document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				'hidden',
				'inert',
				'class',
				'style',
				'data-walkthrough',
				'data-walkthrough-title',
				'data-walkthrough-reason',
				'data-walkthrough-description',
				'data-walkthrough-blocked',
				'data-open',
				'disabled',
				'aria-disabled',
				'aria-hidden',
				'aria-pressed',
			],
		} );
		window.addEventListener( 'resize', findTarget );
		return () => {
			observer.disconnect();
			window.removeEventListener( 'resize', findTarget );
		};
	}, [ targetStep, hasContent, blocked, descriptionId, inSiteDialog, step, setHints ] );

	const eligible =
		!! anchor &&
		anchor.isConnected &&
		!! (
			anchor.dataset.walkthrough?.split( ' ' ).includes( targetStep ?? '' ) ||
			( step === 'intro' && anchor.hasAttribute( 'data-sidebar-toggle' ) )
		) &&
		! blocked &&
		! suspended &&
		!! content &&
		! ( step === 'create' && dismissedCreateStages.includes( createStage ) );
	useEffect( () => {
		if ( ! eligible ) {
			setRevealedAnchor( null );
			return;
		}
		if ( showNextImmediately.current ) {
			showNextImmediately.current = false;
			setRevealedAnchor( anchor );
			return;
		}
		const timer = window.setTimeout( () => setRevealedAnchor( anchor ), 400 );
		return () => window.clearTimeout( timer );
	}, [ eligible, anchor ] );
	const open = eligible && revealedAnchor === anchor;
	useEffect( () => {
		if ( ! anchor?.parentElement ) return;
		const element = document.createElement( 'span' );
		element.style.display = 'contents';
		anchor.after( element );
		setPopoverHost( { anchor, element } );
		return () => element.remove();
	}, [ anchor ] );
	useEffect( () => {
		if ( ! open ) return;
		const target = getFocusTarget( anchor );
		if ( ! target || target.hasAttribute( 'aria-description' ) ) return;
		const ids = target.getAttribute( 'aria-describedby' )?.split( /\s+/ ).filter( Boolean ) ?? [];
		target.setAttribute( 'aria-describedby', [ ...ids, descriptionId ].join( ' ' ) );
		return () => {
			const remaining = target
				.getAttribute( 'aria-describedby' )
				?.split( /\s+/ )
				.filter( ( id ) => id && id !== descriptionId );
			if ( remaining?.length ) target.setAttribute( 'aria-describedby', remaining.join( ' ' ) );
			else target.removeAttribute( 'aria-describedby' );
		};
	}, [ anchor, descriptionId, open ] );
	const track = useWalkthroughTracking(
		targetStep ?? 'unknown',
		open,
		step === 'composer'
			? composerBlocked
				? target.reason ?? 'blocked'
				: 'ready'
			: step === 'intro' && sidebarClosed
			? 'sidebar_closed'
			: 'default'
	);
	const canTryChat = step === 'publish' && !! target.nextElement;
	const nextStep = canTryChat ? 'try-chat' : content?.next;

	useEffect( () => {
		if ( ! anchor || ( ! open && step !== 'create' ) ) return;
		const act = ( event: MouseEvent ) => {
			if ( open ) track( 'target_clicked' );
			const button = event.target instanceof Element ? event.target.closest( 'button' ) : null;
			if ( ! button || button.disabled || button.getAttribute( 'aria-disabled' ) === 'true' )
				return;
			if ( step === 'create' && createStage !== 'gallery' ) {
				setDismissedCreateStages( ( stages ) =>
					stages.includes( createStage ) ? stages : [ ...stages, createStage ]
				);
			} else if ( nextStep && ( step === 'annotate' || step === 'publish' ) ) {
				setHints( {
					walkthroughStep: nextStep,
					whatsNewSeenVersion,
				} );
			}
		};
		anchor.addEventListener( 'click', act, true );
		return () => anchor.removeEventListener( 'click', act, true );
	}, [ open, anchor, step, nextStep, setHints, createStage, track, whatsNewSeenVersion ] );

	if ( ! content || ! popoverHost || popoverHost.anchor !== anchor ) return null;
	const connectStep = step === 'composer' && target.reason === 'connect';
	const blueprintDetails = step === 'create' && createStage === 'details';
	const dismissCreateTip = () => {
		track( 'dismiss' );
		setDismissedCreateStages( ( stages ) => [ ...stages, createStage ] );
		focusAnchor();
	};
	const firstStep = step === 'create' && createStage === 'gallery' && galleryStep === 'fresh';
	const focusAnchor = () => getFocusTarget( anchor )?.focus();
	const finish = ( next: Step, action = 'next' ) => {
		track( action, next );
		if (
			( next === 'completed' || next === 'skipped' ) &&
			document.activeElement
				?.closest( '[data-slot="popover-content"]' )
				?.getAttribute( 'aria-describedby' ) === descriptionId
		) {
			focusAnchor();
		}
		setHints( {
			walkthroughStep: next,
			whatsNewSeenVersion,
		} );
	};
	const continueTour = () => {
		showNextImmediately.current = true;
		finish(
			step === 'composer' &&
				Array.from( document.querySelectorAll< HTMLElement >( ANNOTATE_TARGET ) ).some(
					isAvailable
				)
				? 'annotate'
				: nextStep ?? content.next
		);
	};
	const onPrimary = ( event: ReactMouseEvent< HTMLButtonElement > ) => {
		if ( connectStep || step === 'intro' ) {
			track( connectStep ? 'connect' : 'next' );
			if ( sidebarClosed ) {
				showNextImmediately.current = true;
				focusNextAnchor.current = true;
			}
			anchor?.click();
			return;
		}
		if ( step === 'create' ) {
			if ( firstStep && target.nextElement ) {
				track( 'next' );
				showNextImmediately.current = true;
				setGalleryStep( 'design' );
				target.nextElement.focus();
			} else if ( blueprintDetails ) {
				track( 'next' );
				anchor?.click();
			} else if ( onContinue ) {
				track( 'next' );
				onContinue();
			} else {
				dismissCreateTip();
			}
			return;
		}
		if ( step === 'try-chat' ) {
			const send = anchor && walkthroughPromptSenders.get( anchor );
			if ( ! send ) {
				track( 'prompt_result', 'unavailable' );
				return;
			}
			finish( 'completed', 'send_prompt' );
			void send( __( 'What can you do?' ) ).then(
				() => track( 'prompt_result', 'sent' ),
				() => {
					track( 'prompt_result', 'failed' );
					toast.error( __( 'Could not send the prompt. Please try again.' ) );
				}
			);
			return;
		}
		if ( event.detail === 0 && nextStep !== 'completed' ) focusNextAnchor.current = true;
		continueTour();
	};
	const onSecondary = connectStep
		? ( event: ReactMouseEvent< HTMLButtonElement > ) => {
				if ( event.detail === 0 ) focusNextAnchor.current = true;
				continueTour();
		  }
		: blueprintDetails
		? dismissCreateTip
		: step === 'try-chat'
		? () => finish( 'completed', 'finish' )
		: step === 'intro' || ( firstStep && sites?.length === 0 )
		? () => finish( 'skipped', 'skip' )
		: undefined;
	const onNavigationKeyDown = ( event: KeyboardEvent< HTMLButtonElement > ) => {
		if ( event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey )
			return;
		// Base UI has no trigger to return focus to when this tip uses an external anchor.
		const guards = popoverHost.element.querySelectorAll< HTMLElement >(
			'[data-base-ui-focus-guard][data-type="outside"]'
		);
		const after = guards.item( guards.length - 1 );
		if ( after ) {
			event.preventDefault();
			after.focus();
		}
	};
	return createPortal(
		<FeaturePopover.Root
			key={ sidebarClosed ? 'intro-sidebar' : targetStep }
			open={ open }
			modal={ false }
			onOpenChange={ ( nextOpen, details ) => {
				if ( ! nextOpen && details.reason === 'escape-key' ) {
					details.event.stopPropagation();
					finish( 'skipped', 'escape' );
				}
			} }
		>
			<FeaturePopover.Popup
				anchor={ anchor }
				side={
					step === 'intro'
						? 'right'
						: step === 'composer' || step === 'create' || step === 'try-chat'
						? 'top'
						: 'bottom'
				}
				align={
					step === 'intro' || ( step === 'composer' && target.description ) || firstStep
						? 'start'
						: 'end'
				}
				sideOffset={ 20 }
				backdrop={ false }
				initialFocus={ () => {
					if ( ! focusNextAnchor.current ) return false;
					focusNextAnchor.current = false;
					return getFocusTarget( anchor ) ?? false;
				} }
				finalFocus={ false }
				title={
					step === 'composer' && target.description
						? target.title ?? __( 'Before your first prompt' )
						: content.title
				}
				description={
					step === 'composer' ? target.description ?? content.description : content.description
				}
				descriptionId={ descriptionId }
				footer={
					<FeaturePopover.Navigation
						skipLabel={
							connectStep
								? __( 'Next' )
								: blueprintDetails
								? __( 'Got it' )
								: step === 'try-chat'
								? __( 'Done' )
								: __( 'Skip tour' )
						}
						nextLabel={
							connectStep
								? __( 'Connect' )
								: canTryChat
								? __( 'Next' )
								: step === 'create' && ! blueprintDetails && onContinue
								? __( 'Next' )
								: firstStep && ! target.nextElement
								? __( 'Got it' )
								: content.action
						}
						onSkip={ onSecondary }
						onNext={ onPrimary }
						onNextKeyDown={ onNavigationKeyDown }
					/>
				}
			/>
		</FeaturePopover.Root>,
		popoverHost.element
	);
}
