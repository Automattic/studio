import type { SelectionRect, UseAreaScreenshotReturn } from 'src/hooks/use-area-screenshot';

interface BrowserCaptureOverlayProps {
	areaScreenshot: UseAreaScreenshotReturn;
}

function SelectionBox( { rect }: { rect: SelectionRect } ) {
	return (
		<div
			className="absolute border-2 border-blue-500/80 bg-blue-500/10 rounded-sm pointer-events-none"
			style={ {
				left: rect.x,
				top: rect.y,
				width: rect.width,
				height: rect.height,
			} }
		/>
	);
}

export function BrowserCaptureOverlay( { areaScreenshot }: BrowserCaptureOverlayProps ) {
	const { isCapturing, currentRect, screenshot, handleMouseDown, handleMouseMove, handleMouseUp } =
		areaScreenshot;

	// Show the persistent selection rectangle when a screenshot has been taken
	if ( ! isCapturing && screenshot && currentRect ) {
		return <SelectionBox rect={ currentRect } />;
	}

	if ( ! isCapturing ) {
		return null;
	}

	return (
		<div
			className="absolute inset-0 z-10 cursor-crosshair"
			onMouseDown={ handleMouseDown }
			onMouseMove={ handleMouseMove }
			onMouseUp={ ( e ) => void handleMouseUp( e ) }
		>
			{ currentRect && currentRect.width > 0 && currentRect.height > 0 && (
				<SelectionBox rect={ currentRect } />
			) }
		</div>
	);
}
