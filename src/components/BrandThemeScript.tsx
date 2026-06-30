// BrandThemeScript — Server component that injects brand CSS vars into <head>.
// Reads INTEL_BRAND env at build/request time; defaults to kammandor.
// When brand is kammandor (default), emits NO override style — globals.css values win,
// so the default Kammandor skin is pixel-identical to the pre-white-label state.
import { getBrand, resolveBrandKey } from '@/config/brands';
import type { Brand } from '@/config/brands';

function buildCssVars(brand: Brand): string {
  const c = brand.colors;
  return [
    `--ink:${c.ink}`,
    `--page:${c.page}`,
    `--card:${c.card}`,
    `--card-border:${c.cardBorder}`,
    `--gold:${c.gold}`,
    `--gold-deep:${c.goldDeep}`,
    `--gold-text:${c.goldText}`,
    `--on-ink:${c.onInk}`,
    `--muted:${c.muted}`,
    `--live:${c.live}`,
  ].join(';');
}

export default function BrandThemeScript() {
  const envBrandKey = resolveBrandKey(process.env.INTEL_BRAND);
  // When env is kammandor (the default), skip injecting — globals.css already sets these vars.
  if (envBrandKey === 'kammandor') return null;

  const brand = getBrand(envBrandKey);
  const cssVars = buildCssVars(brand);
  const css = `:root{${cssVars}}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

/** Utility: build a CSS string for a given brand key (used by client-side switcher). */
export function buildBrandCss(brandKey: string): string {
  const brand = getBrand(brandKey);
  if (brand.key === 'kammandor') return ''; // globals.css handles this; no override needed
  return `:root{${buildCssVars(brand)}}`;
}
