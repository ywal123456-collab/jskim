export type UrlClass =
  | 'local'
  | 'same-origin'
  | 'data'
  | 'fragment'
  | 'external'
  | 'blob'
  | 'file'
  | 'javascript'
  | 'empty';

export type ClassifiedUrl = {
  classification: UrlClass;
  /** 絶対 URL（fragment / empty / 相対解決失敗時は null） */
  absoluteUrl: string | null;
  raw: string;
};

/**
 * CSS / HTML 内の参照 URL を分類する。
 * same-origin（base と同じ origin）は local 扱いの収集対象にする。
 */
export function classifyUrl(raw: string, pageUrl: string): ClassifiedUrl {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { classification: 'empty', absoluteUrl: null, raw };
  }
  if (trimmed.startsWith('#')) {
    return { classification: 'fragment', absoluteUrl: null, raw: trimmed };
  }
  if (/^data:/i.test(trimmed)) {
    return { classification: 'data', absoluteUrl: trimmed, raw: trimmed };
  }
  if (/^blob:/i.test(trimmed)) {
    return { classification: 'blob', absoluteUrl: trimmed, raw: trimmed };
  }
  if (/^file:/i.test(trimmed)) {
    return { classification: 'file', absoluteUrl: trimmed, raw: trimmed };
  }
  if (/^javascript:/i.test(trimmed)) {
    return {
      classification: 'javascript',
      absoluteUrl: trimmed,
      raw: trimmed,
    };
  }

  let absolute: URL;
  try {
    absolute = new URL(trimmed, pageUrl);
  } catch {
    return { classification: 'external', absoluteUrl: null, raw: trimmed };
  }

  if (absolute.protocol === 'data:') {
    return { classification: 'data', absoluteUrl: absolute.href, raw: trimmed };
  }
  if (absolute.protocol === 'blob:') {
    return { classification: 'blob', absoluteUrl: absolute.href, raw: trimmed };
  }
  if (absolute.protocol === 'file:') {
    return { classification: 'file', absoluteUrl: absolute.href, raw: trimmed };
  }
  if (absolute.protocol === 'javascript:') {
    return {
      classification: 'javascript',
      absoluteUrl: absolute.href,
      raw: trimmed,
    };
  }

  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return {
      classification: 'external',
      absoluteUrl: absolute.href,
      raw: trimmed,
    };
  }

  if (absolute.origin === page.origin) {
    return {
      classification: 'same-origin',
      absoluteUrl: absolute.href,
      raw: trimmed,
    };
  }

  // 相対パス由来で解決できた同一 host 以外は external
  if (
    absolute.protocol === 'http:' ||
    absolute.protocol === 'https:'
  ) {
    // もともと相対・ルート相対なら local 相当として same-origin に入る
    // 絶対 URL で別 origin なら external
    if (
      !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
      trimmed.startsWith('//')
    ) {
      // protocol-relative は external
      if (trimmed.startsWith('//')) {
        return {
          classification: 'external',
          absoluteUrl: absolute.href,
          raw: trimmed,
        };
      }
      return {
        classification: 'local',
        absoluteUrl: absolute.href,
        raw: trimmed,
      };
    }
    return {
      classification: 'external',
      absoluteUrl: absolute.href,
      raw: trimmed,
    };
  }

  return {
    classification: 'external',
    absoluteUrl: absolute.href,
    raw: trimmed,
  };
}

/** 収集対象（ローカル取得して token 化する）か */
export function isCollectableUrl(classification: UrlClass): boolean {
  return classification === 'local' || classification === 'same-origin';
}

/** そのまま残す参照（data / fragment） */
export function isPassthroughUrl(classification: UrlClass): boolean {
  return classification === 'data' || classification === 'fragment';
}
