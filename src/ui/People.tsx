import { useMemo, useState } from 'react';
import {
  renameLoanPerson,
  renameMember,
  reorderLoanPeople,
  reorderMembers,
  setLoanPersonArchived,
  setMemberArchived,
  upsertLoanPerson,
  upsertMember,
  type LoanPerson,
  type Member,
} from '../core';
import type { PageProps, Route } from './contracts';
import { Icon } from './Icon';
import { ConfirmModal, EmptyState, Field, Modal, PageHeader } from './shared';

type Mode = 'member' | 'loan';
type Person = Member | LoanPerson;

export function PersonForm({
  state,
  bookId,
  busy,
  commit,
  mode,
  person,
  onClose,
  onSaved,
}: PageProps & {
  mode: Mode;
  person?: Person;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const [name, setName] = useState(person?.name ?? '');
  const title = `${person ? '修改' : '新建'}${mode === 'member' ? '成员' : '借贷人'}`;
  return (
    <Modal title={title} busy={busy} onClose={onClose}>
      <form
        className="lj-form"
        onSubmit={async (event) => {
          event.preventDefault();
          let savedId = '';
          const success = await commit(
            (current) => {
              if (person) {
                const existing = (mode === 'member' ? current.members : current.loanPeople).find(
                  (item) => item.id === person.id,
                );
                if (
                  !existing ||
                  existing.name !== person.name ||
                  existing.archived !== person.archived
                )
                  throw new Error('此名称已在其他操作中变更，请重新打开再编辑。');
                savedId = person.id;
                return mode === 'member'
                  ? renameMember(current, person.id, name)
                  : renameLoanPerson(current, person.id, name);
              }
              if (mode === 'member') {
                const next = upsertMember(current, { bookId, name });
                savedId = next.memberId;
                return next.state;
              }
              const next = upsertLoanPerson(current, { bookId, name });
              savedId = next.personId;
              return next.state;
            },
            mode === 'member' ? '成员已保存' : '借贷人已保存',
          );
          if (success) {
            onSaved?.(savedId);
            onClose();
          }
        }}
      >
        <Field label={mode === 'member' ? '成员名称' : '借贷人名称'}>
          <input
            required
            autoFocus
            maxLength={120}
            aria-label={mode === 'member' ? '成员名称' : '借贷人名称'}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={mode === 'member' ? '例如：家庭成员' : '填写对方称呼'}
          />
        </Field>
        <p className="lj-help">
          {mode === 'member'
            ? '成员用来记录这笔收支属于谁，和借贷往来的对方分开管理。'
            : '借入、借出、还款、收款都关联到这里选择的对方。'}
          改名保留已有流水关联。
        </p>
        <div className="lj-form-actions">
          <button type="button" className="lj-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="lj-primary" disabled={busy}>
            {busy ? '正在保存…' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PeopleManager({
  state,
  bookId,
  busy,
  commit,
  mode,
  onBack,
  onDetails,
}: PageProps & {
  mode: Mode;
  onBack: () => void;
  onDetails: (route: Route) => void;
}) {
  const label = mode === 'member' ? '成员' : '借贷人';
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Person | null | undefined>(undefined);
  const [actionId, setActionId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const all = (mode === 'member' ? state.members : state.loanPeople)
    .filter((item) => item.bookId === bookId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const items = all.filter((item) => showArchived || !item.archived);
  const action = all.find((item) => item.id === actionId);
  const archive = all.find((item) => item.id === archiveId);
  const position = all.findIndex((item) => item.id === actionId);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const transaction of state.transactions) {
      if (transaction.bookId !== bookId) continue;
      const id = mode === 'member' ? transaction.memberId : transaction.personId;
      if (id) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [state.transactions, bookId, mode]);
  const move = async (delta: number) => {
    if (!action) return;
    const saved = await commit((current) => {
      const list = (mode === 'member' ? current.members : current.loanPeople)
        .filter((item) => item.bookId === bookId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => item.id);
      const index = list.indexOf(action.id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= list.length) return current;
      [list[index], list[next]] = [list[next], list[index]];
      return mode === 'member'
        ? reorderMembers(current, bookId, list)
        : reorderLoanPeople(current, bookId, list);
    }, `${label}顺序已更新`);
    if (saved) setActionId(null);
  };
  return (
    <section className="lj-screen">
      <PageHeader
        title={`${label}管理`}
        onBack={onBack}
        action={
          <button
            className="lj-icon-button"
            aria-label={`新建${label}`}
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            <Icon name="plus" />
          </button>
        }
      />
      <div className="lj-scroll lj-page-pad">
        <p className="lj-page-intro">
          {mode === 'member'
            ? '按成员区分日常收支。默认成员保留为“自己”；旧账中的“未指定”不会自动归为自己。'
            : '按借贷人查看往来。借贷改变账户余额，不计入普通收入或支出。'}
        </p>
        <div className="lj-management-tools">
          <h2>{label}列表</h2>
          <label>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            显示归档{label}
          </label>
        </div>
        {!items.length && (
          <EmptyState
            title={`还没有${label}`}
            text={`添加后可以在记账时选择。`}
            icon={mode === 'member' ? 'members' : 'loan'}
          >
            <button className="lj-primary" onClick={() => setEditing(null)}>
              新建{label}
            </button>
          </EmptyState>
        )}
        <div className="lj-people-list">
          {items.map((person) => (
            <article
              key={person.id}
              className={`lj-person-card ${person.archived ? 'is-archived' : ''}`}
            >
              <button
                className="lj-person-records"
                disabled={busy}
                onClick={() =>
                  onDetails({
                    screen: 'details',
                    ...(mode === 'member'
                      ? { memberId: person.id }
                      : { personId: person.id, direction: 'loan' }),
                  })
                }
                aria-label={`查看${person.name}的${mode === 'member' ? '流水' : '借贷记录'}`}
              >
                <span className="lj-person-avatar">
                  <Icon name={mode === 'member' ? 'person' : 'loan'} />
                </span>
                <span>
                  <strong>
                    {person.name}
                    {'kind' in person && person.kind === 'self' && <i>默认</i>}
                    {person.archived && <i>已归档</i>}
                  </strong>
                  <small>{counts.get(person.id) ?? 0} 笔关联记录</small>
                </span>
                <Icon name="right" size={16} />
              </button>
              <button
                className="lj-icon-button"
                disabled={busy}
                aria-label={`管理${label} ${person.name}`}
                onClick={() => setActionId(person.id)}
              >
                <Icon name="more" size={21} />
              </button>
            </article>
          ))}
        </div>
        <p className="lj-help">
          归档只会从新增记账选项中隐藏，原有记录继续保留。
          {mode === 'member' ? '默认自己不可归档，但可以改名。' : ''}
        </p>
      </div>
      {editing !== undefined && (
        <PersonForm
          state={state}
          bookId={bookId}
          busy={busy}
          commit={commit}
          mode={mode}
          person={editing ?? undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
      {action && (
        <Modal title={action.name} busy={busy} onClose={() => setActionId(null)}>
          <div className="lj-action-list">
            <button
              disabled={busy}
              onClick={() => {
                setEditing(action);
                setActionId(null);
              }}
            >
              <Icon name="edit" />
              修改名称
              <Icon name="right" size={15} />
            </button>
            <div className="lj-action-pair">
              <button disabled={busy || position <= 0} onClick={() => void move(-1)}>
                <Icon name="up" />
                上移
              </button>
              <button
                disabled={busy || position < 0 || position >= all.length - 1}
                onClick={() => void move(1)}
              >
                <Icon name="down" />
                下移
              </button>
            </div>
            <button
              disabled={busy || ('kind' in action && action.kind === 'self')}
              onClick={() => {
                setArchiveId(action.id);
                setActionId(null);
              }}
            >
              <Icon name={action.archived ? 'restore' : 'archive'} />
              {action.archived ? '恢复使用' : `归档${label}`}
              <Icon name="right" size={15} />
            </button>
          </div>
        </Modal>
      )}
      {archive && (
        <ConfirmModal
          title={archive.archived ? `恢复${label}？` : `归档${label}？`}
          busy={busy}
          onClose={() => setArchiveId(null)}
          confirmLabel={archive.archived ? '恢复使用' : '确认归档'}
          onConfirm={async () => {
            if (
              await commit(
                (current) =>
                  mode === 'member'
                    ? setMemberArchived(current, archive.id, !archive.archived)
                    : setLoanPersonArchived(current, archive.id, !archive.archived),
                `${label}已${archive.archived ? '恢复' : '归档'}`,
              )
            )
              setArchiveId(null);
          }}
        >
          <p>{archive.name}</p>
          <p>历史流水和关联不变，不会删除任何账目。</p>
        </ConfirmModal>
      )}
    </section>
  );
}
