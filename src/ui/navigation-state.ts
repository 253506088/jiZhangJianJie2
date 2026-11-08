import { isValidMonth } from '../core';

export interface DetailsNavigationRequest {
  bookId: string;
  month?: string;
}

/** A request can arrive before props commit, after render, or after the book-change effect. */
export function planDetailsNavigation(
  currentBookId: string,
  settledBookId: string,
  options: { bookId?: string; month?: string },
) {
  if (options.month !== undefined && options.month !== '' && !isValidMonth(options.month)) {
    throw new Error('需要有效的账本月份');
  }
  const request: DetailsNavigationRequest = {
    bookId: options.bookId ?? currentBookId,
    ...(options.month !== undefined ? { month: options.month } : {}),
  };
  return {
    request,
    applyNow: request.bookId === currentBookId,
    retainUntilBookEffect: request.bookId !== currentBookId || currentBookId !== settledBookId,
  };
}

export function resolveBookNavigation(
  nextBookId: string,
  request: DetailsNavigationRequest | null,
) {
  return request?.bookId === nextBookId ? request : null;
}
