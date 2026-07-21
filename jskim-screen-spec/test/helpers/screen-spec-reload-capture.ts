import { ref } from 'vue';

export function createPreviewPanelStub() {
  return {
    runtime: ref({ status: 'idle' as const }),
    persistedCapture: ref(null),
    persistedReference: ref(null),
    localPending: ref(false),
    awaitingManifest: ref(false),
    isCollecting: ref(false),
    isBusy: ref(false),
    actionsDisabled: ref(false),
    statusMessage: ref(''),
    errorMessage: ref(''),
    infoMessage: ref(''),
    dialogError: ref(''),
    figmaConfirmation: ref(null),
    refreshStatus: async () => {},
    collectCurrent: async () => {},
    resumePendingIfNeeded: async () => {},
    stopPolling: () => {},
    uploadOrReplace: async () => ({ ok: false as const }),
    deleteCurrent: async () => {},
    importFromFigma: async () => ({ ok: false as const }),
    reimportFromFigma: async () => ({ ok: false as const }),
    clearDialogError: () => {},
    abortFigmaDialogRequest: () => {},
    clearFigmaConfirmation: () => {},
  };
}

export function createPreviewPanelStubPlain() {
  return {
    runtime: { value: { status: 'idle' as const } },
    persistedCapture: { value: null },
    persistedReference: { value: null },
    localPending: { value: false },
    awaitingManifest: { value: false },
    isCollecting: { value: false },
    isBusy: { value: false },
    actionsDisabled: { value: false },
    statusMessage: { value: '' },
    errorMessage: { value: '' },
    infoMessage: { value: '' },
    dialogError: { value: '' },
    figmaConfirmation: { value: null },
    refreshStatus: async () => {},
    collectCurrent: async () => {},
    resumePendingIfNeeded: async () => {},
    stopPolling: () => {},
    uploadOrReplace: async () => ({ ok: false as const }),
    deleteCurrent: async () => {},
    importFromFigma: async () => ({ ok: false as const }),
    reimportFromFigma: async () => ({ ok: false as const }),
    clearDialogError: () => {},
    abortFigmaDialogRequest: () => {},
    clearFigmaConfirmation: () => {},
  };
}
