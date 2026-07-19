import type { BrowserSafeReferenceSource } from './browser-safe-source.js';
import type { ViewportId } from './presets.js';
import {
  getReferenceImagePublicInfo,
  readSourceReferenceImageBytes,
  viewerReferenceImagePath,
} from './public-info.js';

export type ViewerReferenceImageEntry =
  | { status: 'missing' }
  | { status: 'invalid'; diagnosticCode?: string }
  | {
      status: 'current';
      imagePath: string;
      imageRevision: string;
      imageWidth: number;
      imageHeight: number;
      viewportWidth: number;
      viewportHeight: number;
      uploadedAt: string;
      source: BrowserSafeReferenceSource;
    };

export type ViewerReferenceImages = {
  pc: ViewerReferenceImageEntry;
  sp: ViewerReferenceImageEntry;
};

export type ReferenceImageOutputFile = {
  relativePath: string;
  bytes: Buffer;
};

function buildEntry(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
  viewport: ViewportId;
}): {
  entry: ViewerReferenceImageEntry;
  outputFile: ReferenceImageOutputFile | null;
} {
  const info = getReferenceImagePublicInfo(options);
  if (info.status === 'missing') {
    return { entry: { status: 'missing' }, outputFile: null };
  }
  if (info.status === 'invalid') {
    return {
      entry: {
        status: 'invalid',
        diagnosticCode: 'SPEC_REFERENCE_IMAGE_INVALID',
      },
      outputFile: null,
    };
  }

  if (
    !info.imageFile ||
    !info.imageRevision ||
    !info.uploadedAt ||
    info.imageWidth == null ||
    info.imageHeight == null ||
    info.viewportWidth == null ||
    info.viewportHeight == null
  ) {
    return {
      entry: {
        status: 'invalid',
        diagnosticCode: 'SPEC_REFERENCE_IMAGE_INVALID',
      },
      outputFile: null,
    };
  }

  const bytes = readSourceReferenceImageBytes({
    ...options,
    imageFile: info.imageFile,
  });
  if (!bytes) {
    return {
      entry: {
        status: 'invalid',
        diagnosticCode: 'SPEC_REFERENCE_IMAGE_INVALID',
      },
      outputFile: null,
    };
  }

  const imagePath = viewerReferenceImagePath({
    screenId: options.screenId,
    viewport: options.viewport,
    imageFile: info.imageFile,
  });

  return {
    entry: {
      status: 'current',
      imagePath,
      imageRevision: info.imageRevision,
      imageWidth: info.imageWidth,
      imageHeight: info.imageHeight,
      viewportWidth: info.viewportWidth,
      viewportHeight: info.viewportHeight,
      uploadedAt: info.uploadedAt,
      source: info.source ?? { type: 'upload' },
    },
    outputFile: {
      relativePath: imagePath,
      bytes,
    },
  };
}

/**
 * screen の PC/SP Reference Image を manifest 用に解決する。
 * current の参照画像だけ outputFiles に載せる。
 */
export function resolveViewerReferenceImages(options: {
  rootDir: string;
  projectName: string;
  screenId: string;
}): {
  referenceImages: ViewerReferenceImages;
  outputFiles: ReferenceImageOutputFile[];
  hasReferenceImage: boolean;
} {
  const outputFiles: ReferenceImageOutputFile[] = [];
  const pc = buildEntry({ ...options, viewport: 'pc' });
  const sp = buildEntry({ ...options, viewport: 'sp' });
  if (pc.outputFile) {
    outputFiles.push(pc.outputFile);
  }
  if (sp.outputFile) {
    outputFiles.push(sp.outputFile);
  }
  const hasReferenceImage =
    pc.entry.status === 'current' || sp.entry.status === 'current';
  return {
    referenceImages: {
      pc: pc.entry,
      sp: sp.entry,
    },
    outputFiles,
    hasReferenceImage,
  };
}
