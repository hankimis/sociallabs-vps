/**
 * VPS Backend 공유 유틸리티
 */

/**
 * HTML 특수문자 이스케이프 (XSS 방지)
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 문자열을 안전하게 트림
 */
export function safeString(value: unknown, defaultValue = ''): string {
  if (value === null || value === undefined) return defaultValue;
  return String(value).trim();
}

/**
 * 값을 안전하게 숫자로 변환
 */
export function safeNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue;
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

/**
 * 값을 안전하게 정수로 변환
 */
export function safeInt(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue;
  const num = parseInt(String(value), 10);
  return Number.isFinite(num) ? num : defaultValue;
}

/**
 * 지정된 시간만큼 대기
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 에러를 안전하게 문자열로 변환
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * 객체에서 undefined/null 값을 가진 키 제거
 */
export function removeNullish<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== null && value !== undefined)
  ) as Partial<T>;
}
