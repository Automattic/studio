import type { PlatformAdapter } from '../types.js';
import { defaultAdapter } from './default/index.js';
import { godaddyWmAdapter } from './godaddy-wm/index.js';
import { hostingerAdapter } from './hostinger/index.js';
import { hubspotAdapter } from './hubspot/index.js';
import { resolveAdapter } from './resolve-adapter.js';
import { shopifyAdapter } from './shopify/index.js';
import { squarespaceAdapter } from './squarespace/index.js';
import { webflowAdapter } from './webflow/index.js';
import { weeblyAdapter } from './weebly/index.js';
import { wixAdapter } from './wix/index.js';

export const adapters: PlatformAdapter[] = [
  defaultAdapter,
  godaddyWmAdapter,
  hostingerAdapter,
  hubspotAdapter,
  shopifyAdapter,
  squarespaceAdapter,
  webflowAdapter,
  weeblyAdapter,
  wixAdapter,
];

export function findAdapter(platform: string): PlatformAdapter | null {
  return resolveAdapter(adapters, platform);
}
