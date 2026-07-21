/**
 * Device Capture / Reference Image panel 共通の work identity と直列化。
 * local operation と background reload は同時に active にならない。
 */

import { computed, ref, type Ref } from 'vue';
import type { ScreenDataReloadOutcome } from '../screen-view-bundle.js';

export type PanelWorkKind = 'operation' | 'reload';

export type PanelWorkIdentity = {
  seq: number;
  contextKey: string;
  kind: PanelWorkKind;
};

/** @deprecated PanelWorkIdentity を使用 */
export type PanelOperationIdentity = PanelWorkIdentity;

export type PanelWorkRefs = {
  localPending: Ref<boolean>;
  awaitingManifest: Ref<boolean>;
  reloadPending: Ref<boolean>;
};

export type PanelFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createPanelOperationController(
  getCurrentContextKey: () => string | null,
  isDisposed: () => boolean,
  refs: PanelWorkRefs,
) {
  let workSeq = 0;
  const activeWork = ref<PanelWorkIdentity | null>(null);

  const panelBusy = computed(
    () =>
      refs.localPending.value ||
      refs.awaitingManifest.value ||
      refs.reloadPending.value ||
      activeWork.value !== null,
  );

  function isActiveWork(identity: PanelWorkIdentity | null): boolean {
    if (!identity || isDisposed()) {
      return false;
    }
    if (getCurrentContextKey() !== identity.contextKey) {
      return false;
    }
    const active = activeWork.value;
    if (!active) {
      return false;
    }
    return (
      active.seq === identity.seq &&
      active.contextKey === identity.contextKey &&
      active.kind === identity.kind
    );
  }

  function hasActiveWork(): boolean {
    return panelBusy.value;
  }

  function hasActiveOperation(): boolean {
    return (
      activeWork.value?.kind === 'operation' ||
      refs.localPending.value ||
      refs.awaitingManifest.value
    );
  }

  function hasActiveReload(): boolean {
    return activeWork.value?.kind === 'reload' || refs.reloadPending.value;
  }

  function beginOperation(contextKey: string): PanelWorkIdentity | null {
    if (hasActiveWork()) {
      return null;
    }
    const identity: PanelWorkIdentity = {
      seq: ++workSeq,
      contextKey,
      kind: 'operation',
    };
    activeWork.value = identity;
    refs.localPending.value = true;
    return identity;
  }

  function beginReload(contextKey: string): PanelWorkIdentity | null {
    if (hasActiveWork()) {
      return null;
    }
    const identity: PanelWorkIdentity = {
      seq: ++workSeq,
      contextKey,
      kind: 'reload',
    };
    activeWork.value = identity;
    refs.reloadPending.value = true;
    return identity;
  }

  function finishWork(identity: PanelWorkIdentity): boolean {
    if (!isActiveWork(identity)) {
      return false;
    }
    if (identity.kind === 'operation') {
      refs.localPending.value = false;
      refs.awaitingManifest.value = false;
    } else {
      refs.reloadPending.value = false;
    }
    activeWork.value = null;
    return true;
  }

  function invalidateAllWork(): void {
    workSeq += 1;
    activeWork.value = null;
    refs.localPending.value = false;
    refs.awaitingManifest.value = false;
    refs.reloadPending.value = false;
  }

  async function reloadWithOutcome(
    reloadScreen: () => Promise<ScreenDataReloadOutcome>,
  ): Promise<ScreenDataReloadOutcome> {
    try {
      return await reloadScreen();
    } catch {
      return { status: 'failed' };
    }
  }

  return {
    activeWork,
    panelBusy,
    isActiveWork,
    /** local operation identity 判定（kind=operation） */
    isActiveOperation: isActiveWork,
    hasActiveWork,
    hasActiveOperation,
    hasActiveReload,
    beginOperation,
    beginReload,
    finishWork,
    finishOperation: finishWork,
    invalidateAllWork,
    invalidateOperations: invalidateAllWork,
    reloadWithOutcome,
  };
}
