import type { ProductVersion } from './types';
// US version numbers order one SPL; Canadian observations use their timestamps.
export function versionOrder(a:ProductVersion,b:ProductVersion):number {
  if(a.productId.startsWith('US:')&&/^\d+$/.test(a.version)&&/^\d+$/.test(b.version))return Number(a.version)-Number(b.version);
  const left=Date.parse(a.observedAt||a.publishedAt||a.version),right=Date.parse(b.observedAt||b.publishedAt||b.version);
  if(Number.isFinite(left)&&Number.isFinite(right)&&left!==right)return left-right;
  return Number.isFinite(left)&&Number.isFinite(right)?0:NaN;
}
