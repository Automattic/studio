import '@/lib/theme/tokens.css';
import '@/lib/theme/base.css';
import '@/index.css';
import { useId, useState } from 'react';
import { AnnotateIcon } from '@/lib/icons';
import { Button, FeaturePopover } from '@/lib/ui';
import { renderPlayground } from './playground';

function Tip() {
	const [ open, setOpen ] = useState( true );
	return (
		<div style={ { padding: 48, minHeight: 320, display: 'flex', justifyContent: 'center' } }>
			<FeaturePopover.Root open={ open } onOpenChange={ setOpen }>
				<FeaturePopover.Trigger
					render={
						<Button variant="accent-ghost">
							<AnnotateIcon />
							Annotate
						</Button>
					}
				/>
				<FeaturePopover.Popup
					side="bottom"
					align="end"
					sideOffset={ 10 }
					initialFocus={ false }
					tone="accent"
					badge="New"
					title="Try Annotate"
					description="Point to anything and describe what you want to change."
					onDismiss={ () => setOpen( false ) }
				/>
			</FeaturePopover.Root>
		</div>
	);
}

function Walkthrough() {
	const [ step, setStep ] = useState( 0 );
	const annotateId = useId();
	const publishId = useId();
	const open = step < 2;
	return (
		<div style={ { padding: 48, minHeight: 360 } }>
			<div style={ { display: 'flex', justifyContent: 'flex-end', gap: 16 } }>
				<FeaturePopover.Root
					open={ open }
					triggerId={ step === 0 ? annotateId : publishId }
					onOpenChange={ ( next ) => {
						if ( ! next ) setStep( 2 );
					} }
				>
					<FeaturePopover.Trigger
						id={ annotateId }
						render={
							<Button variant="accent-ghost">
								<AnnotateIcon />
								Annotate
							</Button>
						}
					/>
					<FeaturePopover.Trigger
						id={ publishId }
						render={ <Button variant="accent-ghost">Publish</Button> }
					/>
					<FeaturePopover.Popup
						tone="accent"
						side="bottom"
						align="end"
						sideOffset={ 10 }
						initialFocus={ false }
						title={ step === 0 ? 'Point to what you want to change' : 'Share what you’ve made' }
						description={
							step === 0
								? 'Select anything on your site and leave a note. Studio will help you make the change.'
								: 'Publish your site when you’re ready to share it with the world.'
						}
						onDismiss={ () => setStep( 2 ) }
						footer={
							<FeaturePopover.Navigation
								stepLabel={ `${ step + 1 } of 2` }
								nextLabel={ step === 0 ? 'Next' : 'Done' }
								onNext={ () => setStep( step + 1 ) }
								onSkip={ () => setStep( 2 ) }
							/>
						}
					/>
				</FeaturePopover.Root>
			</div>
			{ ! open ? <Button onClick={ () => setStep( 0 ) }>Restart walkthrough</Button> : null }
		</div>
	);
}

function Preview() {
	const [ walkthrough, setWalkthrough ] = useState( true );
	return (
		<>
			<div style={ { padding: 16 } }>
				<Button variant="outline" onClick={ () => setWalkthrough( ! walkthrough ) }>
					{ walkthrough ? 'Show announcement' : 'Show walkthrough' }
				</Button>
			</div>
			{ walkthrough ? <Walkthrough /> : <Tip /> }
		</>
	);
}

renderPlayground( 'Feature popovers', <Preview /> );
