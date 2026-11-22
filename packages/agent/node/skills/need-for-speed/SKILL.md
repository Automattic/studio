---
name: need-for-speed
description: Run a frontend performance audit on a WordPress site and get actionable optimization recommendations.
user-invokable: true
---

# Performance Audit

Run a performance audit on a WordPress site to measure Core Web Vitals and page composition, then provide actionable recommendations.

## How to Run

1. Determine which site to audit. If the user hasn't specified, ask them or use the site from the current context.
2. Ensure the site is running (use `site_start` if needed).
3. Call `need_for_speed` with the site name and path (defaults to `/`).
4. Analyze the results using the interpretation guide below.
5. Present a clear summary with specific, actionable recommendations.

## Interpreting Results

### Core Web Vitals Thresholds

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| TTFB | < 800 ms | 800–1800 ms | > 1800 ms |
| FCP | < 1800 ms | 1800–3000 ms | > 3000 ms |
| LCP | < 2500 ms | 2500–4000 ms | > 4000 ms |
| CLS | < 0.1 | 0.1–0.25 | > 0.25 |

### Page Composition Benchmarks

- **DOM elements**: Concern if > 1500
- **Total page weight**: Concern if > 3 MB
- **Total requests**: Concern if > 80
- **Scripts**: Concern if > 20 scripts or > 500 KB total
- **Stylesheets**: Concern if > 10 stylesheets or > 200 KB total

## Common WordPress Recommendations

Based on the metrics, suggest specific actions:

- **High TTFB**: Enable page caching (e.g., `wp_cli: plugin install wp-super-cache --activate`), check for slow database queries, consider object caching.
- **High LCP / FCP**: Check for render-blocking CSS/JS, add lazy loading for below-the-fold images, defer non-critical scripts.
- **Large JS payload**: Identify heavy plugins from the scripts URL list, suggest deactivating unused plugins, check for jQuery dependency chains.
- **Large CSS payload**: Look for unused theme stylesheets, check for multiple Google Fonts loads.
- **Many HTTP requests**: Suggest reducing plugin count, enabling asset concatenation.
- **High CLS**: Check for images without explicit width/height dimensions, ads or dynamic content injection, web fonts causing layout shifts.
- **Large DOM**: Check theme template complexity, excessive nesting in block content, too many wrapper elements.

## Important Notes

- These are **synthetic measurements on a local dev server**. TTFB will be artificially low compared to production. Focus on relative comparisons (before/after changes) rather than absolute values.
- CLS is measured during page load only, not during user interaction.
- INP (Interaction to Next Paint) is not measured — it requires real user interaction patterns.
- Page weight may undercount if some resources report 0 transfer size (e.g., service worker cached resources).
