import type { WooProduct } from '../../lib/woo-csv/index.js';
import type {
  ShopifyProductJson,
  ShopifyGqlVariantLike,
} from './types.js';
import type { ShopifyGqlProduct } from '../../lib/extraction/shopify-graphql.js';

/**
 * Normalize a Shopify weight+unit pair to kilograms. Shopify variant objects
 * expose `weight` in the unit named by `weight_unit` — to feed WooCommerce a
 * single consistent unit we convert everything to kg. Returns undefined for
 * zero/missing weights so we don't emit `"0"` rows.
 */
export function normalizeWeightToKg(weight: number | undefined, unit: string | undefined): string | undefined {
  if (weight == null || weight === 0) return undefined;
  const u = (unit || 'kg').toLowerCase();
  let kg: number;
  switch (u) {
    case 'kg': kg = weight; break;
    case 'g':  kg = weight / 1000; break;
    case 'lb': kg = weight * 0.453592; break;
    case 'oz': kg = weight * 0.0283495; break;
    default:   kg = weight; // unknown unit — pass through
  }
  // Trim to 4 decimals, drop trailing zeros
  return Number(kg.toFixed(4)).toString();
}

/**
 * Convert a Shopify product JSON payload into a WooProduct parent + variation rows.
 *
 * `sourceUrl` is stamped on the parent so the import pipeline can link the
 * WooCommerce product back to its Shopify storefront URL. Variations inherit
 * the parent's page on the storefront, so they don't get their own sourceUrl.
 */
export function shopifyProductToWoo(
  product: ShopifyProductJson,
  sourceUrl?: string,
): { parent: WooProduct; variations: WooProduct[] } {
  const variants = product.variants || [];
  const options = product.options || [];

  const isVariable = variants.length > 1 || (options.length > 0 && options[0]?.name !== 'Title');

  // Collect images from 3 sources: featured image, images array, inline body HTML
  const imageSet = new Set<string>();
  if (product.image?.src) imageSet.add(product.image.src);
  for (const img of product.images || []) {
    imageSet.add(img.src);
  }
  // Extract inline images from body_html
  const inlineImgRegex = /src="(https?:\/\/[^"']+\.(jpg|jpeg|png|gif|webp)[^"']*)"/gi;
  let inlineMatch;
  while ((inlineMatch = inlineImgRegex.exec(product.body_html || '')) !== null) {
    imageSet.add(inlineMatch[1]);
  }
  const images = [...imageSet];

  const firstVariant = variants[0];
  const tags = product.tags
    ? product.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : [];
  const categories = product.product_type ? [product.product_type] : [];

  // Simple-product sale price: when compareAtPrice > price, Shopify treats
  // the compareAtPrice as the original and price as the current (sale) price.
  // Mirror this in WooCommerce so discounts survive the import. Guard both
  // values through Number.isFinite so empty-string prices can't false-positive.
  const jsonPriceNum = firstVariant?.price ? Number(firstVariant.price) : NaN;
  const jsonCompareNum = firstVariant?.compare_at_price ? Number(firstVariant.compare_at_price) : NaN;
  const simpleHasSale =
    !isVariable &&
    Number.isFinite(jsonPriceNum) &&
    Number.isFinite(jsonCompareNum) &&
    jsonCompareNum > jsonPriceNum;

  const parent: WooProduct = {
    name: product.title,
    type: isVariable ? 'variable' : 'simple',
    // Variable products need a SKU so variations can reference them via parent_id.
    // Use the product handle as a stable identifier if no explicit SKU exists.
    sku: isVariable ? (product.handle || product.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')) : (firstVariant?.sku || ''),
    published: true,
    description: product.body_html || '',
    regularPrice: isVariable
      ? ''
      : (simpleHasSale ? String(firstVariant!.compare_at_price) : (firstVariant?.price || '')),
    salePrice: simpleHasSale ? (firstVariant?.price || undefined) : undefined,
    categories,
    tags,
    images,
    inStock: firstVariant?.available !== false,
    stock: firstVariant?.inventory_quantity != null ? firstVariant.inventory_quantity : undefined,
    sourceUrl,
  };

  if (options.length > 0) {
    parent.attributes = options.map((opt) => ({
      name: opt.name,
      values: opt.values,
      visible: true,
      global: false,
    }));
  }

  const parentWeight = normalizeWeightToKg(firstVariant?.weight, firstVariant?.weight_unit);
  if (parentWeight) parent.weight = parentWeight;

  // Build image lookup: image ID → src, and variant ID → image src
  const imageById = new Map<number, string>();
  const imageByVariantId = new Map<number, string>();
  for (const img of product.images || []) {
    if (img.id) imageById.set(img.id, img.src);
    for (const vid of img.variant_ids || []) {
      imageByVariantId.set(vid, img.src);
    }
  }

  // Build variation rows for variable products
  const variations: WooProduct[] = [];
  if (isVariable) {
    for (const variant of variants) {
      const hasCompareAtPrice = variant.compare_at_price != null && variant.compare_at_price !== '';

      // Resolve variant image: featured_image > image_id lookup > variant_id lookup
      let variantImage: string | undefined;
      if (variant.featured_image?.src) {
        variantImage = variant.featured_image.src;
      } else if (variant.image_id && imageById.has(variant.image_id)) {
        variantImage = imageById.get(variant.image_id);
      } else if (variant.id && imageByVariantId.has(variant.id)) {
        variantImage = imageByVariantId.get(variant.id);
      }

      const variation: WooProduct = {
        name: product.title,
        type: 'variation',
        sku: variant.sku || '',
        parentSku: parent.sku,
        published: true,
        description: '',
        regularPrice: hasCompareAtPrice ? String(variant.compare_at_price) : variant.price || '',
        salePrice: hasCompareAtPrice ? variant.price || undefined : undefined,
        inStock: variant.available !== false,
        stock: variant.inventory_quantity != null ? variant.inventory_quantity : undefined,
        ...(variantImage ? { images: [variantImage] } : {}),
      };

      const variationWeight = normalizeWeightToKg(variant.weight, variant.weight_unit);
      if (variationWeight) variation.weight = variationWeight;

      // Single-value attributes for this variant
      const variantAttributes: WooProduct['attributes'] = [];
      if (variant.option1 != null && options[0]) {
        variantAttributes.push({ name: options[0].name, values: [variant.option1], visible: true, global: false });
      }
      if (variant.option2 != null && options[1]) {
        variantAttributes.push({ name: options[1].name, values: [variant.option2], visible: true, global: false });
      }
      if (variant.option3 != null && options[2]) {
        variantAttributes.push({ name: options[2].name, values: [variant.option3], visible: true, global: false });
      }
      if (variantAttributes.length > 0) {
        variation.attributes = variantAttributes;
      }

      variations.push(variation);
    }
  }

  return { parent, variations };
}

/**
 * Map a Shopify GraphQL product node to WooProduct parent + variations.
 *
 * Exploits data the public JSON API does not expose:
 *   - compareAtPrice → sale-price semantics (on simple AND variable products)
 *   - inventoryPolicy + inventoryItem.tracked → real stock status
 *   - inventoryItem.unitCost → cost-of-goods meta
 *   - inventoryItem.measurement.weight → normalized kg weight
 *   - collections → category hierarchy candidates
 *   - metafields namespace:global + seo{} → SEO title/description
 *   - variant media → per-variation image
 */
export function shopifyGraphqlProductToWoo(
  product: ShopifyGqlProduct,
  sourceUrl?: string,
): { parent: WooProduct; variations: WooProduct[] } {
  const variantEdges = product.variants?.edges || [];
  const variants = variantEdges.map((e) => e.node);
  const options = product.options || [];

  const isVariable =
    variants.length > 1 || (options.length > 0 && options[0]?.name !== 'Title');

  // Collect images: featured + media edges + inline body HTML
  const imageSet = new Set<string>();
  if (product.featuredMedia?.image?.url) imageSet.add(product.featuredMedia.image.url);
  for (const m of product.media?.edges || []) {
    if (m.node.image?.url) imageSet.add(m.node.image.url);
  }
  const inlineImgRegex = /src="(https?:\/\/[^"']+\.(jpg|jpeg|png|gif|webp)[^"']*)"/gi;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineImgRegex.exec(product.descriptionHtml || '')) !== null) {
    imageSet.add(inlineMatch[1]);
  }
  const images = [...imageSet];

  const firstVariant = variants[0];
  const tags = product.tags || [];

  // Category mapping: prefer collection titles (with product_type as fallback)
  // for richer taxonomy. Collections become flat categories — WooCommerce
  // doesn't have a native concept of Shopify collection hierarchy.
  const categorySet = new Set<string>();
  for (const edge of product.collections?.edges || []) {
    if (edge.node.title) categorySet.add(edge.node.title);
  }
  if (categorySet.size === 0 && product.productType) {
    categorySet.add(product.productType);
  }
  const categories = [...categorySet];

  // Real stock status: tracked + policy + quantity
  const computeStock = (v: ShopifyGqlVariantLike): { inStock: boolean; stock?: number } => {
    const tracked = v.inventoryItem?.tracked;
    const policy = v.inventoryPolicy;
    const qty = v.inventoryQuantity;
    // Untracked variants are always in stock in Shopify's model
    if (!tracked) return { inStock: true };
    // Tracked: depend on qty and oversell policy
    if (qty == null) return { inStock: true, stock: undefined };
    if (qty > 0) return { inStock: true, stock: qty };
    // qty <= 0 and tracked
    return { inStock: policy === 'CONTINUE', stock: qty };
  };

  const firstStock = firstVariant ? computeStock(firstVariant) : { inStock: true };

  // Only treat as a sale when BOTH prices are non-empty positive numbers.
  // Guards against empty-string price coercing to 0 (would spuriously mark
  // a free product as discounted).
  const priceNum = firstVariant?.price ? Number(firstVariant.price) : NaN;
  const compareNum = firstVariant?.compareAtPrice ? Number(firstVariant.compareAtPrice) : NaN;
  const simpleHasSale =
    !isVariable &&
    Number.isFinite(priceNum) &&
    Number.isFinite(compareNum) &&
    compareNum > priceNum;

  const parent: WooProduct = {
    name: product.title,
    type: isVariable ? 'variable' : 'simple',
    sku: isVariable
      ? (product.handle || product.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      : (firstVariant?.sku || ''),
    published: product.status === 'ACTIVE',
    description: product.descriptionHtml || '',
    regularPrice: isVariable
      ? ''
      : (simpleHasSale ? String(firstVariant!.compareAtPrice) : (firstVariant?.price || '')),
    salePrice: simpleHasSale ? (firstVariant?.price || undefined) : undefined,
    categories,
    tags,
    images,
    inStock: firstStock.inStock,
    stock: firstStock.stock,
    sourceUrl,
  };

  // SEO: prefer product.seo, fall back to global metafields for title/description.
  // Shopify has been known to return metafields: null on stores without any —
  // optional-chain all the way to find() so we don't crash on empty shops.
  const seoTitle = product.seo?.title
    || product.metafields?.edges?.find((e) => e.node.key === 'title_tag')?.node.value
    || '';
  const seoDesc = product.seo?.description
    || product.metafields?.edges?.find((e) => e.node.key === 'description_tag')?.node.value
    || '';
  if (seoTitle) parent.seoTitle = seoTitle;
  if (seoDesc) parent.seoDescription = seoDesc;

  // Cost of goods from Shopify's unitCost — only set when we have a numeric
  // amount, since Woo's CSV importer treats the meta column as a price-typed
  // field. Currency code is dropped (Woo uses a single store-wide currency).
  const firstCost = firstVariant?.inventoryItem?.unitCost?.amount;
  if (firstCost && Number.isFinite(Number(firstCost))) {
    parent.costOfGoods = firstCost;
  }

  if (options.length > 0) {
    parent.attributes = options.map((opt) => ({
      name: opt.name,
      values: opt.values,
      visible: true,
      global: false,
    }));
  }

  const parentWeightKg = normalizeWeightToKg(
    firstVariant?.inventoryItem?.measurement?.weight?.value,
    firstVariant?.inventoryItem?.measurement?.weight?.unit,
  );
  if (parentWeightKg) parent.weight = parentWeightKg;

  const variations: WooProduct[] = [];
  if (isVariable) {
    for (const variant of variants) {
      const vPriceNum = variant.price ? Number(variant.price) : NaN;
      const vCompareNum = variant.compareAtPrice ? Number(variant.compareAtPrice) : NaN;
      const hasSale =
        Number.isFinite(vPriceNum) &&
        Number.isFinite(vCompareNum) &&
        vCompareNum > vPriceNum;

      const variantImage = variant.media?.edges?.[0]?.node?.image?.url;
      const variantStock = computeStock(variant);

      const variation: WooProduct = {
        name: product.title,
        type: 'variation',
        sku: variant.sku || '',
        parentSku: parent.sku,
        published: true,
        description: '',
        regularPrice: hasSale ? String(variant.compareAtPrice) : variant.price || '',
        salePrice: hasSale ? variant.price || undefined : undefined,
        inStock: variantStock.inStock,
        stock: variantStock.stock,
        ...(variantImage ? { images: [variantImage] } : {}),
      };

      const variationWeight = normalizeWeightToKg(
        variant.inventoryItem?.measurement?.weight?.value,
        variant.inventoryItem?.measurement?.weight?.unit,
      );
      if (variationWeight) variation.weight = variationWeight;

      const variantCost = variant.inventoryItem?.unitCost?.amount;
      if (variantCost && Number.isFinite(Number(variantCost))) {
        variation.costOfGoods = variantCost;
      }

      const variantAttributes: WooProduct['attributes'] = [];
      for (const selected of variant.selectedOptions || []) {
        variantAttributes.push({
          name: selected.name,
          values: [selected.value],
          visible: true,
          global: false,
        });
      }
      if (variantAttributes.length > 0) variation.attributes = variantAttributes;

      variations.push(variation);
    }
  }

  return { parent, variations };
}
