import type { Page } from 'playwright';
import { createDeviceCaptureError } from './errors.js';

const FONT_TIMEOUT_MS = 10000;
const IMAGE_TIMEOUT_MS = 10000;

export const ANIMATION_DISABLE_CSS = `
*,
*::before,
*::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  caret-color: transparent !important;
}
`;

/**
 * Capture 直前の描画安定化（fonts / images / animation 無効）。
 * networkidle は使わない。
 * page.evaluate は文字列渡し（build lib に DOM を含めない）。
 */
export async function stabilizePageForCapture(page: Page): Promise<void> {
  try {
    await page.evaluate(
      `async (timeoutMs) => {
        const ready = document.fonts && document.fonts.ready;
        if (!ready) {
          return;
        }
        await Promise.race([
          ready,
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new Error('document.fonts.ready timeout')),
              timeoutMs,
            );
          }),
        ]);
      }`,
      FONT_TIMEOUT_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_STABILIZE_TIMEOUT',
      `フォントの読み込み待機がタイムアウトしました。原因: ${message}`,
    );
  }

  try {
    await page.evaluate(
      `async (timeoutMs) => {
        const images = Array.from(document.images || []);
        await Promise.race([
          Promise.all(
            images.map(
              (img) =>
                new Promise((resolve) => {
                  if (img.complete) {
                    resolve();
                    return;
                  }
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                }),
            ),
          ),
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new Error('image load timeout')),
              timeoutMs,
            );
          }),
        ]);
      }`,
      IMAGE_TIMEOUT_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createDeviceCaptureError(
      'SPEC_DEVICE_CAPTURE_STABILIZE_TIMEOUT',
      `画像の読み込み待機がタイムアウトしました。原因: ${message}`,
    );
  }

  await page.addStyleTag({ content: ANIMATION_DISABLE_CSS });

  await page.evaluate(`() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  })`);
}
