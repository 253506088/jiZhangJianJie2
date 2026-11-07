import {
  ensureAccountDraft,
  ensureBookDraft,
  ensureCategoryPathDraft,
  withLedgerDraft,
} from '../core/commands';
import {
  isValidDate,
  makeId,
  nowIso,
  type CommandContext,
  type ImportBatch,
  type LedgerState,
  type Transaction,
} from '../core/model';
import { addCents } from '../core/money';
import { ensureMemberDraft, ensureLoanPersonDraft } from '../core/people';
import type { ImportOptions, ImportPlan, RowIssue } from './types';

export interface ImportResult {
  state: LedgerState;
  added: number;
  duplicateRows: number;
  filteredRows: number;
  overlapCandidates: number;
  createdBooks: number;
  createdAccounts: number;
  createdCategories: number;
  createdMembers: number;
  createdLoanPeople: number;
  latestDate: string | null;
  firstBookId: string;
  batchIds: string[];
  issues: RowIssue[];
  totals: Record<Transaction['direction'], number>;
}

function signature(transaction: Transaction) {
  return JSON.stringify([
    transaction.bookId,
    transaction.direction,
    transaction.amountCents,
    transaction.date,
    transaction.time ?? '',
    transaction.accountId,
    transaction.toAccountId,
    transaction.categoryId,
    transaction.note,
    transaction.memberId,
    transaction.loanType,
    transaction.personId,
    transaction.transferType ?? '',
  ]);
}

/** Produces an isolated, fully validated draft for preview or one atomic repository commit. */
export function applyImport(
  state: LedgerState,
  plan: ImportPlan,
  options: ImportOptions,
  context: CommandContext = {},
): ImportResult {
  if (
    (options.fromDate && !isValidDate(options.fromDate)) ||
    (options.toDate && !isValidDate(options.toDate)) ||
    (options.fromDate && options.toDate && options.fromDate > options.toDate)
  )
    throw new Error('导入日期范围无效。');
  if (plan.errors.length && !options.allowRejectedRows)
    throw new Error('存在未通过校验的行，请修正映射，或明确选择仅导入有效行。');
  const target = state.books.find((book) => book.id === options.targetBookId && !book.archived);
  if (!target) throw new Error('目标账本不存在或已归档。');
  const issues = [...plan.skipped];
  const stats = {
    added: 0,
    duplicateRows: 0,
    filteredRows: 0,
    overlapCandidates: 0,
    createdBooks: 0,
    createdAccounts: 0,
    createdCategories: 0,
    createdMembers: 0,
    createdLoanPeople: 0,
    latestDate: null as string | null,
    firstBookId: target.id,
    batchIds: [] as string[],
    issues,
    totals: { income: 0, expense: 0, transfer: 0, loan: 0 },
  };
  const existingContent = new Map<string, number>();
  const sameFileBatches = new Set(
    state.imports.filter((batch) => batch.digest === plan.workbook.digest).map((batch) => batch.id),
  );
  for (const transaction of state.transactions) {
    // Different rows in the same source file are known distinct records, even with identical content.
    if (transaction.source && sameFileBatches.has(transaction.source.batchId)) continue;
    existingContent.set(
      signature(transaction),
      (existingContent.get(signature(transaction)) ?? 0) + 1,
    );
  }
  const previousKeys = new Set<string>();
  const conservativeBooks = new Set<string>();
  for (const batch of state.imports.filter((batch) => batch.digest === plan.workbook.digest)) {
    if (!batch.sourceRows) conservativeBooks.add(batch.bookId);
    else
      for (const source of batch.sourceRows)
        previousKeys.add(JSON.stringify([batch.bookId, source.sheet, source.row]));
  }
  const next = withLedgerDraft(state, (draft) => {
    const batches = new Map<string, ImportBatch>();
    const importedAt = nowIso(context);
    const firstCounts = {
      books: draft.books.length,
      accounts: draft.accounts.length,
      categories: draft.categories.length,
      members: draft.members.length,
      loanPeople: draft.loanPeople.length,
    };
    for (const row of plan.rows) {
      if (
        (options.fromDate && row.date < options.fromDate) ||
        (options.toDate && row.date > options.toDate)
      ) {
        stats.filteredRows++;
        issues.push({
          sheet: row.sheet,
          row: row.row,
          code: 'OUTSIDE_RANGE',
          message: '在用户选择的日期范围之外',
        });
        continue;
      }
      const book =
        options.useBookColumn && row.book ? ensureBookDraft(draft, row.book, context) : target;
      const sourceKey = JSON.stringify([book.id, row.sheet, row.row]);
      if (conservativeBooks.has(book.id) || previousKeys.has(sourceKey)) {
        stats.duplicateRows++;
        issues.push({
          sheet: row.sheet,
          row: row.row,
          code: 'ALREADY_IMPORTED',
          message: '同一文件的这一行已导入（含之后手动删除的记录）',
        });
        continue;
      }
      previousKeys.add(sourceKey);
      let batch = batches.get(book.id);
      if (!batch) {
        batch = {
          id: makeId(context),
          bookId: book.id,
          digest: plan.workbook.digest,
          fileName: plan.workbook.fileName,
          importedAt,
          totalRows: 0,
          importedRows: 0,
          skippedRows: 0,
          rejectedRows: 0,
          transactionIds: [],
          sourceRows: [],
        };
        batches.set(book.id, batch);
      }
      const account = ensureAccountDraft(draft, book.id, row.account, context);
      const destination =
        row.direction === 'transfer'
          ? ensureAccountDraft(draft, book.id, row.toAccount!, context)
          : null;
      const category =
        row.direction === 'expense' || row.direction === 'income'
          ? ensureCategoryPathDraft(
              draft,
              {
                bookId: book.id,
                direction: row.direction,
                primaryName: row.primary,
                secondaryName: row.secondary,
              },
              context,
            )
          : null;
      const transaction: Transaction = {
        id: makeId(context),
        bookId: book.id,
        direction: row.direction,
        amountCents: row.amountCents,
        date: row.date,
        ...(row.time ? { time: row.time } : {}),
        accountId: account.id,
        toAccountId: destination?.id ?? null,
        categoryId: category?.id ?? null,
        note: row.note,
        memberId:
          row.direction === 'loan'
            ? null
            : ensureMemberDraft(draft, book.id, row.member ?? '未指定', context).id,
        loanType: row.loanType,
        personId:
          row.direction === 'loan'
            ? ensureLoanPersonDraft(draft, book.id, row.person ?? '未指定', context).id
            : null,
        ...(row.transferType ? { transferType: row.transferType } : {}),
        createdAt: importedAt,
        updatedAt: importedAt,
        source: { batchId: batch.id, sheet: row.sheet, row: row.row, rawDate: row.rawDate },
      };
      const match = signature(transaction);
      const existing = existingContent.get(match) ?? 0;
      if (existing > 0) {
        stats.overlapCandidates++;
        existingContent.set(match, existing - 1);
      }
      draft.transactions.push(transaction);
      batch.transactionIds.push(transaction.id);
      batch.sourceRows!.push({ sheet: row.sheet, row: row.row, transactionId: transaction.id });
      batch.importedRows++;
      batch.totalRows++;
      stats.added++;
      if (!stats.latestDate || row.date > stats.latestDate) stats.latestDate = row.date;
      stats.totals[row.direction] = addCents(stats.totals[row.direction], row.amountCents);
    }
    const firstBatch = [...batches.values()][0];
    if (firstBatch) {
      firstBatch.rejectedRows = plan.errors.length;
      firstBatch.skippedRows = issues.length;
      firstBatch.totalRows += firstBatch.rejectedRows + firstBatch.skippedRows;
      stats.firstBookId = firstBatch.bookId;
      draft.settings.selectedBookId = firstBatch.bookId;
      draft.imports.push(...batches.values());
      stats.batchIds = [...batches.values()].map((batch) => batch.id);
    }
    stats.createdBooks = draft.books.length - firstCounts.books;
    stats.createdAccounts = draft.accounts.length - firstCounts.accounts;
    stats.createdCategories = draft.categories.length - firstCounts.categories;
    stats.createdMembers = draft.members.length - firstCounts.members;
    stats.createdLoanPeople = draft.loanPeople.length - firstCounts.loanPeople;
  });
  return { state: next, ...stats };
}
