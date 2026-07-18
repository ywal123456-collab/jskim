import fs from 'node:fs';
import { referenceMetaPath } from './paths.js';
import type {
  GetReferenceImageStatusOptions,
  ReferenceImageMetadata,
  ReferenceImageStatus,
} from './types.js';
import { validatePersistedReferenceImage } from './validate-metadata.js';

export type GetReferenceImageStatusResult = {
  status: ReferenceImageStatus;
  metadata?: ReferenceImageMetadata;
  reason?: string;
};

export function getReferenceImageStatus(
  options: GetReferenceImageStatusOptions,
): GetReferenceImageStatusResult {
  const metaPath = referenceMetaPath(options);
  if (!fs.existsSync(metaPath)) {
    return { status: 'missing' };
  }

  const validated = validatePersistedReferenceImage({
    metaPath,
    expectedScreenId: options.screenId,
    expectedViewport: options.viewport,
  });
  if (!validated.ok) {
    return { status: 'invalid', reason: validated.reason };
  }

  return {
    status: 'current',
    metadata: validated.metadata,
  };
}
