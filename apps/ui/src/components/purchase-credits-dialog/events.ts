export const OPEN_PURCHASE_CREDITS_EVENT = 'studio:open-purchase-credits';

export function openPurchaseCreditsDialog() {
	window.dispatchEvent( new Event( OPEN_PURCHASE_CREDITS_EVENT ) );
}
