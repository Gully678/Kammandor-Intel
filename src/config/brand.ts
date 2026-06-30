// Re-exports from multi-brand registry.
// Existing imports of `BRAND` continue to work unchanged — returns kammandor (default).
export { getBrand, resolveBrandKey } from './brands';
import { getBrand } from './brands';
export const BRAND = getBrand();
