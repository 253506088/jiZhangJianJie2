import { describe, expect, it } from 'vitest';
import { createCategoryPath, createEmptyState, setCategoryArchived, createBook } from '../core';
import { searchEntryCategories } from './editor-state';

function fixture() {
  let count = 0;
  const context = { idFactory: () => `search-${++count}`, now: () => '2026-11-10T00:00:00.000Z' };
  let state = createEmptyState(context);
  const bookId = state.settings.selectedBookId;
  const add = (
    primaryName: string,
    secondaryName: string,
    direction: 'income' | 'expense' = 'expense',
    book = bookId,
  ) => {
    const result = createCategoryPath(
      state,
      { bookId: book, primaryName, secondaryName, direction },
      context,
    );
    state = result.state;
    return result.categoryId;
  };
  const food = add('餐饮', '其他');
  const travel = add('交通', '其他');
  const breakfast = add('餐饮', 'Breakfast');
  const income = add('收入', '其他', 'income');
  const otherBook = createBook(state, '另一本虚构账本', context);
  state = otherBook.state;
  add('餐饮', '其他', 'expense', otherBook.bookId);
  return { state, bookId, food, travel, breakfast, income };
}

describe('跨一级分类搜索', () => {
  it('保留同名二级分类的不同身份与完整父子路径，隔离收支和账本', () => {
    const { state, bookId, food, travel } = fixture();
    expect(
      searchEntryCategories(state, bookId, 'expense', '其他').map(({ category, path }) => [
        category.id,
        path,
      ]),
    ).toEqual([
      [food, '餐饮 / 其他'],
      [travel, '交通 / 其他'],
    ]);
  });
  it('支持名称、完整路径多关键词和英文大小写', () => {
    const { state, bookId, travel, breakfast } = fixture();
    expect(
      searchEntryCategories(state, bookId, 'expense', ' 交通  其他 ').map(
        ({ category }) => category.id,
      ),
    ).toEqual([travel]);
    expect(
      searchEntryCategories(state, bookId, 'expense', 'breakfast').map(
        ({ category }) => category.id,
      ),
    ).toEqual([breakfast]);
    expect(searchEntryCategories(state, bookId, 'expense', '不存在')).toEqual([]);
    expect(searchEntryCategories(state, bookId, 'expense', '   ')).toEqual([]);
  });
  it('排除归档二级和其归档父类，编辑历史记录可保留自身', () => {
    const { state, bookId, food, travel } = fixture();
    const parentId = state.categories.find((category) => category.id === travel)!.parentId!;
    const archived = setCategoryArchived(setCategoryArchived(state, food, true), parentId, true);
    expect(searchEntryCategories(archived, bookId, 'expense', '其他')).toEqual([]);
    expect(
      searchEntryCategories(archived, bookId, 'expense', '其他', travel).map(
        ({ category }) => category.id,
      ),
    ).toEqual([travel]);
  });
});
