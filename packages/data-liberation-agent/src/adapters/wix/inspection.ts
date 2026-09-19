import type { CapabilityRule } from '../../lib/inspect-rendered.js';

export const inspection: CapabilityRule[] = [
  { capability: 'booking', selector: '[data-hook*="booking"],iframe[src*="bookings"],a[href*="/booking-calendar/"],a[href*="/service-page/"]', evidence: 'Wix booking surface; calendar/availability backend requires migration' },
  { capability: 'commerce', selector: '[data-hook="product-page"],[data-hook*="add-to-cart"],a[href*="/product-page/"]', evidence: 'Wix Stores surface; checkout backend requires migration' },
  { capability: 'commerce', selector: '[data-hook="get-tickets-button"],[data-hook*="ticket"],a[href*="/event-details/"]', evidence: 'Wix Events surface; ticketing and inventory backend requires migration' },
  { capability: 'membership', selector: '[data-hook*="members-login"],[data-testid="login-bar"]', evidence: 'Wix member authentication surface' },
];
