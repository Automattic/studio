import { useCallback, useRef, useState } from 'react';
import { useIframePicker } from '../hooks/use-iframe-picker';
import { Banner } from './Banner';
import { ConfirmationModal } from './ConfirmationModal';
import { HighlightOverlay } from './HighlightOverlay';
import { SiteIframe } from './SiteIframe';
import { Tooltip } from './Tooltip';
import type { PickedElement } from '../lib/types';

export function App() {
	const iframeRef = useRef< HTMLIFrameElement | null >( null );
	const [ iframeReady, setIframeReady ] = useState( false );
	const [ lastSelected, setLastSelected ] = useState< PickedElement | null >( null );

	const handleSelected = useCallback( ( element: PickedElement ) => {
		setLastSelected( element );
	}, [] );

	const {
		highlightRect,
		tooltipInfo,
		selected,
		grabAnother,
	} = useIframePicker( iframeRef, iframeReady, handleSelected );

	const handleIframeReady = useCallback( () => {
		setIframeReady( true );
	}, [] );

	const handleGrabAnother = useCallback( () => {
		grabAnother();
		setLastSelected( null );
	}, [ grabAnother ] );

	return (
		<>
			<Banner selected={ selected } />
			<SiteIframe iframeRef={ iframeRef } onReady={ handleIframeReady } />
			{ ! selected && <HighlightOverlay rect={ highlightRect } /> }
			{ ! selected && tooltipInfo && (
				<Tooltip
					label={ tooltipInfo.label }
					top={ tooltipInfo.rect.top }
					left={ tooltipInfo.rect.left }
				/>
			) }
			{ selected && lastSelected && (
				<ConfirmationModal
					element={ lastSelected }
					onGrabAnother={ handleGrabAnother }
				/>
			) }
		</>
	);
}
