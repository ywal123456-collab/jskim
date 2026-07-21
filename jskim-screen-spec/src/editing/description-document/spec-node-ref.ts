import type { SpecNodeRef } from './types.js';

export function specNodeRefEquals(a: SpecNodeRef, b: SpecNodeRef): boolean {
  return a.type === b.type && a.id === b.id;
}

export function specNodeRefKey(ref: SpecNodeRef): string {
  return `${ref.type}:${ref.id}`;
}
