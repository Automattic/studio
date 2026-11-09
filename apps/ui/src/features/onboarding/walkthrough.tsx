import { useSearch } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { FeaturePopover } from '@/lib/ui';
import { useOnboardingGuide } from './onboarding-guide/use-onboarding-guide';
import { WHATS_NEW_VERSION } from './onboarding-guide/whats-new';
import { GETTING_STARTED_REPLAY_EVENT, useOpenGettingStarted } from './use-open-getting-started';
import type { OnboardingHintsState } from '@/data/core';

type Step = NonNullable< OnboardingHintsState[ 'walkthroughStep' ] >;
type CreateStage = 'gallery' | 'details' | 'setup';
type GalleryStep = 'fresh' | 'design';

function getStep(
	step: Step,
	createStage: CreateStage,
	signedIn: boolean,
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
							'Start from scratch, try a design, or bring an existing site into Studio. You can explore without creating another site.'
					  ),
				action: sidebarClosed ? __( 'Show sidebar' ) : __( 'Next' ),
				next: 'create' as const,
			};
		case 'create':
			return {
				title:
					createStage === 'gallery'
						? galleryStep === 'fresh'
							? __( 'Start from scratch' )
							: __( 'Start with a design' )
						: __( 'Make it yours' ),
				description:
					createStage === 'setup'
						? __(
								'Create a fresh WordPress site, then shape it with prompts. You can change its name later.'
						  )
						: createStage === 'details'
						? __( 'Create a site with this design and its content, then shape it with prompts.' )
						: galleryStep === 'fresh'
						? __(
								'A blank WordPress site, ready to become whatever you have in mind. Already have a site? Connect it or import a backup instead.'
						  )
						: __( 'Pick a design with content already in place, then make it yours.' ),
				action:
					createStage === 'gallery'
						? galleryStep === 'fresh'
							? __( 'Next' )
							: __( 'Browse designs' )
						: __( 'Got it' ),
				next: 'composer' as const,
			};
		case 'composer':
			return {
				title: __( 'Make any change' ),
				description: __(
					'Say what you want in plain words. Add a page, swap the colors, fix the thing that’s bugging you.'
				),
				action: __( 'Next' ),
				next: 'share' as const,
			};
		case 'share':
			return {
				title: __( 'Share a preview' ),
				description: signedIn
					? __( 'Grab a link and send it to whoever needs to weigh in.' )
					: __( 'Log in to WordPress.com to get a preview link you can send around.' ),
				action: __( 'Next' ),
				next: 'publish' as const,
			};
		case 'publish':
			return {
				title: __( 'Publish when ready' ),
				description: signedIn
					? __( 'When it looks right, publish and it’s live.' )
					: __( 'Log in to WordPress.com when you’re ready to take it live.' ),
				action: __( 'Done' ),
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
	const { data: user } = useAuthUser();
	const descriptionId = useId();
	const [ target, setTarget ] = useState< {
		element: HTMLElement | null;
		nextElement?: HTMLElement | null;
		title?: string;
		description?: string;
	} >( { element: null } );
	const anchor = target.element;
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
	const sidebarClosed = step === 'intro' && !! anchor?.hasAttribute( 'data-sidebar-toggle' );
	const matchesPlacement = inSiteDialog ? step === 'create' : step !== 'create';
	const content =
		step && matchesPlacement
			? getStep( step, createStage, !! user, galleryStep, sidebarClosed )
			: null;
	const hasContent = content !== null;
	const targetStep =
		step === 'create'
			? createStage === 'details'
				? 'create-blueprint'
				: createStage === 'setup'
				? 'create-site'
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
			setHints( { walkthroughStep: 'composer', whatsNewSeenVersion: WHATS_NEW_VERSION } );
		}
		if ( step === 'annotate' ) {
			setHints( { walkthroughStep: 'share', annotateHintDismissed: true } );
		}
	}, [ step, sites?.length, welcome, addSite, setHints, inSiteDialog ] );

	useEffect( () => {
		if ( ! hasContent || blocked ) {
			setTarget( ( current ) => ( current.element ? { element: null } : current ) );
			return;
		}
		const findTarget = () => {
			const target =
				Array.from(
					document.querySelectorAll< HTMLElement >( `[data-walkthrough~="${ targetStep }"]` )
				).find( isAvailable ) ??
				( step === 'intro'
					? Array.from( document.querySelectorAll< HTMLElement >( '[data-sidebar-toggle]' ) ).find(
							isAvailable
					  )
					: undefined );
			const nextElement =
				targetStep === 'create'
					? Array.from(
							document.querySelectorAll< HTMLElement >( '[data-walkthrough~="create-design"]' )
					  ).find( isAvailable ) ?? null
					: null;
			const title = target?.dataset.walkthroughTitle;
			const description = target?.dataset.walkthroughDescription;
			setTarget( ( current ) =>
				current.element === ( target ?? null ) &&
				current.nextElement === nextElement &&
				current.title === title &&
				current.description === description
					? current
					: { element: target ?? null, nextElement, title, description }
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
	}, [ targetStep, hasContent, blocked, descriptionId, inSiteDialog, step ] );

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
	const nextStep = content?.next;

	useEffect( () => {
		if (
			( ! open && step !== 'create' ) ||
			! nextStep ||
			! anchor ||
			! [ 'create', 'share', 'publish' ].includes( step ?? '' ) ||
			( step === 'create' && createStage === 'gallery' )
		)
			return;
		const act = ( event: MouseEvent ) => {
			if ( ! ( event.target instanceof Element ) || ! anchor.contains( event.target ) ) return;
			const button = event.target.closest( 'button' );
			if ( ! button || button.disabled || button.getAttribute( 'aria-disabled' ) === 'true' )
				return;
			if ( step === 'create' ) {
				setDismissedCreateStages( ( stages ) =>
					stages.includes( createStage ) ? stages : [ ...stages, createStage ]
				);
				return;
			}
			setHints( {
				walkthroughStep: nextStep,
				whatsNewSeenVersion: WHATS_NEW_VERSION,
			} );
		};
		document.addEventListener( 'click', act, true );
		return () => document.removeEventListener( 'click', act, true );
	}, [ open, anchor, step, nextStep, setHints, createStage ] );

	if ( ! content ) return null;
	const steps = [ 'create', 'create-design', 'composer', 'share', 'publish' ];
	const firstStep = step === 'create' && createStage === 'gallery' && galleryStep === 'fresh';
	const stepLabel = sprintf(
		/* translators: 1: current walkthrough step, 2: total number of steps. */
		__( '%1$d/%2$d' ),
		steps.indexOf( step === 'create' && ! firstStep ? 'create-design' : step ?? '' ) + 1,
		steps.length
	);
	const focusAnchor = () => {
		const dialog = anchor?.closest( '[role="dialog"]' );
		const focusTarget =
			anchor instanceof HTMLButtonElement && anchor.disabled
				? dialog?.querySelector< HTMLElement >( '[aria-invalid="true"]' ) ??
				  dialog?.querySelector< HTMLElement >( 'input:not([disabled])' )
				: anchor?.matches( 'button, input, textarea, [tabindex]' )
				? anchor
				: anchor?.querySelector< HTMLElement >(
						'textarea, input, [contenteditable="true"], button'
				  ) ?? dialog?.querySelector< HTMLElement >( '[data-start-blank]' );
		focusTarget?.focus();
	};
	const finish = ( next: Step ) => {
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
			whatsNewSeenVersion: WHATS_NEW_VERSION,
		} );
	};
	return (
		<FeaturePopover.Root
			key={ sidebarClosed ? 'intro-sidebar' : targetStep }
			open={ open }
			modal={ false }
			onOpenChange={ ( nextOpen, details ) => {
				if ( ! nextOpen && details.reason === 'escape-key' ) {
					details.event.stopPropagation();
					finish( 'skipped' );
				}
			} }
		>
			<FeaturePopover.Popup
				anchor={ anchor }
				side={
					step === 'intro' ? 'right' : step === 'composer' || step === 'create' ? 'top' : 'bottom'
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
					return anchor ?? false;
				} }
				finalFocus={ false }
				title={
					step === 'composer' && target.description
						? target.title ?? __( 'Before your first prompt' )
						: content.title
				}
				aria-label={
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
						skipLabel={ __( 'Skip tour' ) }
						stepLabel={
							step === 'intro' ||
							( step === 'create' && createStage !== 'gallery' ) ||
							( step === 'composer' && composerBlocked )
								? undefined
								: stepLabel
						}
						nextLabel={
							step === 'create' && onContinue
								? __( 'Next' )
								: firstStep && ! target.nextElement
								? __( 'Got it' )
								: content.action
						}
						onSkip={
							step === 'intro' || ( firstStep && sites?.length === 0 )
								? () => finish( 'skipped' )
								: undefined
						}
						onNext={
							step === 'intro'
								? () => {
										if ( sidebarClosed ) {
											showNextImmediately.current = true;
											focusNextAnchor.current = true;
										}
										anchor?.click();
								  }
								: step === 'create'
								? () => {
										if ( firstStep && target.nextElement ) {
											showNextImmediately.current = true;
											setGalleryStep( 'design' );
											target.nextElement.focus();
											return;
										}
										if ( onContinue ) {
											onContinue();
											return;
										}
										setDismissedCreateStages( ( stages ) => [ ...stages, createStage ] );
										focusAnchor();
								  }
								: () => {
										showNextImmediately.current = true;
										finish( content.next );
								  }
						}
					/>
				}
			/>
		</FeaturePopover.Root>
	);
}
