'use strict';

/**
 * 公開監査用: 予約された example domain の例示メールかどうかを判定します。
 * それ以外のメール形式は従来どおり検出対象です。
 *
 * @param {string} email
 * @returns {boolean}
 */
function isReservedExampleEmail(email) {
  if (typeof email !== 'string') {
    return false;
  }
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return false;
  }
  const domain = trimmed.slice(at + 1);
  return (
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net' ||
    domain === 'example.invalid'
  );
}

/**
 * 公開ソースに残してよいメールかどうかを判定します。
 *
 * @param {string} email
 * @param {Set<string>} allowedExactEmails
 * @returns {boolean}
 */
function isAllowedPublicEmail(email, allowedExactEmails) {
  if (typeof email !== 'string') {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (allowedExactEmails && allowedExactEmails.has(normalized)) {
    return true;
  }
  return isReservedExampleEmail(normalized);
}

module.exports = {
  isReservedExampleEmail,
  isAllowedPublicEmail,
};
