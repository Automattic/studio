// test/canary/wix-live.test.ts
import { describe, it, expect } from 'vitest';
import { wixAdapter } from '../../src/adapters/wix/index.js';

// This test hits a real Wix site. Run manually:
//   npx vitest run test/canary/wix-live.test.ts
//
// It verifies that Wix's internal APIs haven't changed in ways
// that break our extraction. If this fails, update the adapter
// and add a DISCOVERIES.md entry.

const TEST_URL = 'https://www.wix.com/blog';

describe('Wix live canary', () => {
  it('can discover a real Wix site', async () => {
    const inventory = await wixAdapter.discover(TEST_URL, {});
    expect(inventory.platform).toBe('wix');
    expect(inventory.urls.length).toBeGreaterThan(0);
    expect(inventory.siteMeta.title).toBeTruthy();
    console.log(`  Discovered ${inventory.urls.length} URLs`);
    console.log(`  Site title: ${inventory.siteMeta.title}`);
  }, 60000);
});
