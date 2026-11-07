import { accounts, categoryFor, money, type Entry } from '../domain/ledger';
import { Icon } from './Icon';

export function EntryList({
  entries,
  onEdit,
  showPath = false,
}: {
  entries: Entry[];
  onEdit: (entry: Entry) => void;
  showPath?: boolean;
}) {
  if (!entries.length)
    return (
      <div className="empty-state">
        <Icon name="book" size={34} />
        <strong>这一页，还等着你的第一笔</strong>
        <span>从一顿早餐开始，慢慢记下生活。</span>
      </div>
    );
  return (
    <div className="entry-list">
      {entries.map((entry) => {
        const { parent, child, path } = categoryFor(entry.categoryId);
        const account = accounts.find((item) => item.id === entry.accountId)!;
        return (
          <button
            className="entry-row"
            key={entry.id}
            onClick={() => onEdit(entry)}
            aria-label={`编辑${path}，${money(entry.amountCents)}元`}
          >
            <span className={`category-icon ${parent.id}`}>
              <Icon name={child.icon} size={21} />
            </span>
            <span className="entry-copy">
              <strong>{showPath ? path : child.name}</strong>
              <span>
                {entry.note || parent.name}
                <i>·</i>
                {account.shortName}
              </span>
            </span>
            <span className={`entry-amount ${entry.direction}`}>
              {entry.direction === 'expense' ? '−' : '+'}
              {money(entry.amountCents)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
