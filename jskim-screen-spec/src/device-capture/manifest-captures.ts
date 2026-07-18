import type { ViewportId } from './presets.js';
import {
  getDeviceCapturePublicInfo,
  readSourceCaptureImageBytes,
  viewerDeviceCaptureImagePath,
} from './public-info.js';

export type ViewerDeviceCaptureEntry =
  | { status: 'missing' }
  | { status: 'invalid'; diagnosticCode?: string }
  | {
      status: 'current' | 'stale';
      imagePath: string;
      inputRevision: string;
      imageRevision: string;
      capturedAt: string;
      viewportWidth: number;
      viewportHeight: number;
      imageWidth: number;
      imageHeight: number;
    };

export type ViewerDeviceCaptures = {
  pc: ViewerDeviceCaptureEntry;
  sp: ViewerDeviceCaptureEntry;
};

export type DeviceCaptureOutputFile = {
  relativePath: string;
  bytes: Buffer;
};

function buildEntry(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
  viewport: ViewportId;
}): {
  entry: ViewerDeviceCaptureEntry;
  outputFile: DeviceCaptureOutputFile | null;
} {
  const info = getDeviceCapturePublicInfo(options);
  if (info.status === 'missing') {
    return { entry: { status: 'missing' }, outputFile: null };
  }
  if (info.status === 'invalid') {
    return {
      entry: {
        status: 'invalid',
        diagnosticCode: 'SPEC_DEVICE_CAPTURE_INVALID',
      },
      outputFile: null,
    };
  }

  if (
    !info.imageFile ||
    !info.inputRevision ||
    !info.imageRevision ||
    !info.capturedAt ||
    info.imageWidth == null ||
    info.imageHeight == null ||
    info.viewportWidth == null ||
    info.viewportHeight == null
  ) {
    return {
      entry: {
        status: 'invalid',
        diagnosticCode: 'SPEC_DEVICE_CAPTURE_INVALID',
      },
      outputFile: null,
    };
  }

  const bytes = readSourceCaptureImageBytes({
    ...options,
    imageFile: info.imageFile,
  });
  if (!bytes) {
    return {
      entry: {
        status: 'invalid',
        diagnosticCode: 'SPEC_DEVICE_CAPTURE_INVALID',
      },
      outputFile: null,
    };
  }

  const imagePath = viewerDeviceCaptureImagePath({
    screenId: options.screenId,
    stateId: options.stateId,
    viewport: options.viewport,
    imageFile: info.imageFile,
  });

  return {
    entry: {
      status: info.status,
      imagePath,
      inputRevision: info.inputRevision,
      imageRevision: info.imageRevision,
      capturedAt: info.capturedAt,
      viewportWidth: info.viewportWidth,
      viewportHeight: info.viewportHeight,
      imageWidth: info.imageWidth,
      imageHeight: info.imageHeight,
    },
    outputFile: {
      relativePath: imagePath,
      bytes,
    },
  };
}

/**
 * state の PC/SP Device Capture を manifest 用に解決する。
 * current/stale の参照画像だけ outputFiles に載せる。
 */
export function resolveViewerDeviceCaptures(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  stateId: string;
}): {
  deviceCaptures: ViewerDeviceCaptures;
  outputFiles: DeviceCaptureOutputFile[];
} {
  const outputFiles: DeviceCaptureOutputFile[] = [];
  const pc = buildEntry({ ...options, viewport: 'pc' });
  const sp = buildEntry({ ...options, viewport: 'sp' });
  if (pc.outputFile) {
    outputFiles.push(pc.outputFile);
  }
  if (sp.outputFile) {
    outputFiles.push(sp.outputFile);
  }
  return {
    deviceCaptures: {
      pc: pc.entry,
      sp: sp.entry,
    },
    outputFiles,
  };
}
