import type { KeyboardEvent } from 'react';

// Keys pressed while an IME (Chinese, Japanese, Korean input) is composing
// belong to the IME: Enter confirms a candidate, Escape cancels it. Safari
// fires the confirming keydown after `compositionend`, so `isComposing` is
// already false there and only keyCode 229 gives it away.
export function isImeComposing( event: KeyboardEvent ): boolean {
	return event.nativeEvent.isComposing || event.keyCode === 229;
}
