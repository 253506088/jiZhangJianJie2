import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { localDate, makeId, type Transaction } from '../core';
import type {
  CommitChange,
  ProductionAppHandle,
  ProductionAppProps,
  Route,
  Screen,
} from './contracts';
import {
  BackLayerContext,
  BusyContext,
  CommitFeedbackContext,
  EmptyState,
  PageHeader,
} from './shared';
import { PageBoundary } from './PageBoundary';
import { Icon } from './Icon';
import { Home } from './Home';
import { OverviewHome } from './OverviewHome';
import { PeopleManager } from './People';
import { Editor } from './Editor';
import { Details, Reports } from './DetailsReports';
import { Accounts, Books, Categories } from './Manage';
import { Budgets, DataSettings, Templates } from './Settings';
import './styles.css';
import './legacy-ui.css';
import {
  planDetailsNavigation,
  resolveBookNavigation,
  type DetailsNavigationRequest,
} from './navigation-state';

interface NavigationEntry {
  id: string;
  route: Route;
}
const firstRoute: NavigationEntry = { id: 'home', route: { screen: 'home' } };

export const ProductionApp = forwardRef<ProductionAppHandle, ProductionAppProps>(
  function ProductionApp(
    {
      state,
      busy,
      mutate,
      onImport,
      onExport,
      onExcelExport,
      onReconcile,
      onRestore,
      onHistory,
      dataTools,
    },
    ref,
  ) {
    const [routes, setRoutes] = useState<NavigationEntry[]>([firstRoute]);
    const [month, setMonth] = useState(localDate().slice(0, 7));
    const [pending, setPending] = useState(false);
    const [toast, setToast] = useState<{ message: string; error: boolean; serial: number } | null>(
      null,
    );
    const [systemDark, setSystemDark] = useState(
      () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
    );
    const route = routes[routes.length - 1].route;
    const currentBookId = state.settings.selectedBookId;
    const previousBook = useRef(currentBookId);
    const pendingDetails = useRef<DetailsNavigationRequest | null>(null);
    const currentBookRef = useRef(currentBookId);
    const busyRef = useRef(busy);
    const writingRef = useRef(false);
    const routesRef = useRef(routes);
    const backLayers = useRef<Array<() => void>>([]);
    const mainRef = useRef<HTMLElement>(null);
    busyRef.current = busy;
    currentBookRef.current = currentBookId;
    routesRef.current = routes;
    const effectiveBusy = busy || pending;
    const notify = useCallback((message: string, error = false) => {
      setToast((current) => ({ message, error, serial: (current?.serial ?? 0) + 1 }));
    }, []);
    const clearError = useCallback(() => setToast(null), []);
    useEffect(() => {
      if (!toast) return;
      const timer = setTimeout(() => setToast(null), toast.error ? 6500 : 2800);
      return () => clearTimeout(timer);
    }, [toast]);
    useEffect(() => {
      if (typeof matchMedia === 'undefined') return;
      const media = matchMedia('(prefers-color-scheme: dark)');
      const update = () => setSystemDark(media.matches);
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
      }
      media.addListener(update);
      return () => media.removeListener(update);
    }, []);
    useEffect(() => {
      if (previousBook.current !== currentBookId) {
        previousBook.current = currentBookId;
        const requested = resolveBookNavigation(currentBookId, pendingDetails.current);
        pendingDetails.current = null;
        if (requested) {
          if (requested.month !== undefined) setMonth(requested.month);
          setRoutes([firstRoute, { id: makeId(), route: { screen: 'details' } }]);
        } else setRoutes([firstRoute]);
      }
    }, [currentBookId]);
    useEffect(() => {
      mainRef.current?.focus({ preventScroll: true });
    }, [routes.length, routes[routes.length - 1].id]);
    const commit: CommitChange = useCallback(
      async (operation, message) => {
        if (busyRef.current || writingRef.current) return false;
        writingRef.current = true;
        setPending(true);
        try {
          await mutate(operation);
          if (message) notify(message);
          return true;
        } catch (cause) {
          notify(
            cause instanceof Error ? cause.message : '保存未完成，请重试。原账本仍保留。',
            true,
          );
          return false;
        } finally {
          writingRef.current = false;
          setPending(false);
        }
      },
      [mutate, notify],
    );
    const registerBackLayer = useCallback((handler: () => void) => {
      backLayers.current.push(handler);
      return () => {
        backLayers.current = backLayers.current.filter((value) => value !== handler);
      };
    }, []);
    const pop = useCallback(() => {
      if (busyRef.current || writingRef.current) return;
      setRoutes((items) => (items.length > 1 ? items.slice(0, -1) : items));
    }, []);
    useImperativeHandle(
      ref,
      () => ({
        back() {
          if (busyRef.current || writingRef.current) return true;
          const layer = backLayers.current.at(-1);
          if (layer) {
            layer();
            return true;
          }
          if (routesRef.current.length > 1) {
            pop();
            return true;
          }
          return false;
        },
        showTransactions(options = {}) {
          const request = planDetailsNavigation(
            currentBookRef.current,
            previousBook.current,
            options,
          );
          pendingDetails.current = request.retainUntilBookEffect ? request.request : null;
          if (request.applyNow) {
            if (request.request.month !== undefined) setMonth(request.request.month);
            setRoutes([firstRoute, { id: makeId(), route: { screen: 'details' } }]);
          }
        },
      }),
      [pop],
    );
    const navigate = useCallback((next: Route) => {
      if (busyRef.current || writingRef.current) return;
      if (next.screen === 'home') {
        setRoutes([firstRoute]);
        return;
      }
      setRoutes((items) => [...items, { id: makeId(), route: next }]);
    }, []);
    const openEntry = (transaction: Transaction) =>
      navigate({ screen: 'entry', transactionId: transaction.id });
    const finishEntry = (destination: 'home' | 'details' | 'templates', entryMonth?: string) => {
      if (entryMonth) setMonth(entryMonth);
      if (destination === 'home') {
        setRoutes([firstRoute]);
        return;
      }
      setRoutes((items) => {
        const previous = items.slice(0, -1);
        if (previous.at(-1)?.route.screen === destination) return previous;
        return [firstRoute, { id: makeId(), route: { screen: destination } }];
      });
    };
    const book = state.books.find((item) => item.id === currentBookId)!;
    const theme =
      state.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.settings.theme;
    const pageProps = { state, bookId: currentBookId, busy: effectiveBusy, commit };
    const renderRoute = (entry: NavigationEntry) => {
      const item = entry.route;
      if (item.screen === 'home')
        return state.settings.homeLayout === 'overview' ? (
          <OverviewHome {...pageProps} navigate={navigate} onImport={onImport} onMonth={setMonth} />
        ) : (
          <Home
            {...pageProps}
            month={month || localDate().slice(0, 7)}
            onMonth={setMonth}
            navigate={navigate}
            onImport={onImport}
            onOpen={openEntry}
          />
        );
      if (item.screen === 'entry') {
        const transaction = state.transactions.find((value) => value.id === item.transactionId);
        const template = state.templates.find((value) => value.id === item.templateId);
        if ((item.transactionId && !transaction) || (item.templateId && !template))
          return (
            <section className="lj-screen">
              <PageHeader title="记录已变更" onBack={pop} />
              <EmptyState title="这条记录已经不存在" text="返回后重新选择一条记录。" />
            </section>
          );
        return (
          <Editor
            {...pageProps}
            transaction={transaction}
            template={template}
            templateOnly={item.templateOnly}
            onBack={pop}
            onDone={finishEntry}
          />
        );
      }
      if (item.screen === 'details')
        return (
          <Details
            {...pageProps}
            month={month}
            onMonth={setMonth}
            route={item}
            onBack={pop}
            onOpen={openEntry}
          />
        );
      if (item.screen === 'reports')
        return (
          <Reports
            {...pageProps}
            month={month}
            onMonth={setMonth}
            onBack={pop}
            onDrill={navigate}
          />
        );
      if (item.screen === 'accounts')
        return (
          <Accounts
            {...pageProps}
            onBack={pop}
            onDetails={(accountId) => navigate({ screen: 'details', accountId })}
            onLoans={() => {
              setMonth('');
              navigate({ screen: 'details', direction: 'loan' });
            }}
          />
        );
      if (item.screen === 'categories') return <Categories {...pageProps} onBack={pop} />;
      if (item.screen === 'books') return <Books {...pageProps} onBack={pop} />;
      if (item.screen === 'members')
        return (
          <PeopleManager
            {...pageProps}
            mode="member"
            onBack={pop}
            onDetails={(next) => {
              setMonth('');
              navigate(next);
            }}
          />
        );
      if (item.screen === 'loanPeople')
        return (
          <PeopleManager
            {...pageProps}
            mode="loan"
            onBack={pop}
            onDetails={(next) => {
              setMonth('');
              navigate(next);
            }}
          />
        );
      if (item.screen === 'budgets')
        return (
          <Budgets
            {...pageProps}
            initialPeriod={item.budgetPeriod}
            month={month || localDate().slice(0, 7)}
            onMonth={setMonth}
            onBack={pop}
          />
        );
      if (item.screen === 'templates')
        return (
          <Templates
            {...pageProps}
            onBack={pop}
            onOpen={(templateId, edit) =>
              navigate({ screen: 'entry', templateId, templateOnly: edit })
            }
          />
        );
      return (
        <DataSettings
          {...pageProps}
          onBack={pop}
          navigate={navigate}
          onImport={onImport}
          onExport={onExport}
          onExcelExport={onExcelExport}
          onReconcile={onReconcile}
          onRestore={onRestore}
          onHistory={onHistory}
          dataTools={dataTools}
        />
      );
    };
    const sideNav: { screen: Screen; label: string; icon: string }[] = [
      { screen: 'home', label: '首页', icon: 'home' },
      { screen: 'details', label: '收支明细', icon: 'list' },
      { screen: 'accounts', label: '我的账户', icon: 'wallet' },
      { screen: 'reports', label: '收支报表', icon: 'chart' },
      { screen: 'categories', label: '分类管理', icon: 'category' },
      { screen: 'templates', label: '模板记账', icon: 'layers' },
      { screen: 'members', label: '成员管理', icon: 'members' },
      { screen: 'loanPeople', label: '借贷往来', icon: 'loan' },
      { screen: 'data', label: '数据与设置', icon: 'settings' },
    ];
    return (
      <BackLayerContext.Provider value={registerBackLayer}>
        <BusyContext.Provider value={effectiveBusy}>
          <CommitFeedbackContext.Provider
            value={{ error: toast?.error ? toast.message : null, clearError }}
          >
            <div
              className="ledger-app"
              data-theme={theme}
              data-home-layout={state.settings.homeLayout}
              data-accent={state.settings.accentColor}
              aria-busy={effectiveBusy}
            >
              <a className="lj-skip-link" href="#ledger-main">
                跳到内容
              </a>
              <aside className="lj-sidebar">
                <div className="lj-sidebar-brand">
                  <span className="lj-brand-mark">
                    <Icon name="book" size={25} />
                  </span>
                  <div>
                    <strong>简洁记账</strong>
                    <small>把日常，记清楚。</small>
                  </div>
                </div>
                <button
                  className="lj-sidebar-book"
                  disabled={effectiveBusy || route.screen === 'entry'}
                  onClick={() => navigate({ screen: 'books' })}
                >
                  <span>{book.name}</span>
                  <Icon name="expand" size={16} />
                </button>
                <button
                  className="lj-primary"
                  disabled={effectiveBusy || route.screen === 'entry'}
                  onClick={() => navigate({ screen: 'entry' })}
                >
                  <Icon name="plus" />
                  记一笔
                </button>
                <nav aria-label="主要功能">
                  {sideNav.map((item) => (
                    <button
                      key={item.screen}
                      disabled={effectiveBusy || route.screen === 'entry'}
                      aria-current={route.screen === item.screen ? 'page' : undefined}
                      className={route.screen === item.screen ? 'selected' : ''}
                      onClick={() => {
                        if (item.screen === route.screen) return;
                        if (item.screen === 'home') navigate(item);
                        else
                          setRoutes([firstRoute, { id: makeId(), route: { screen: item.screen } }]);
                      }}
                    >
                      <Icon name={item.icon} size={21} />
                      {item.label}
                    </button>
                  ))}
                </nav>
                <div className="lj-sidebar-footer">
                  <Icon name="shield" size={17} />
                  <span>
                    保存在本机
                    <br />
                    <small>备份由你自己掌握</small>
                  </span>
                </div>
              </aside>
              <main id="ledger-main" ref={mainRef} tabIndex={-1} className="lj-main">
                {routes.map((entry, index) => (
                  <div
                    className="lj-route-frame"
                    key={entry.id}
                    hidden={index !== routes.length - 1}
                  >
                    <PageBoundary
                      resetState={state}
                      resetContext={month}
                      busy={effectiveBusy}
                      onHome={() => navigate({ screen: 'home' })}
                      onExport={onExport}
                    >
                      {renderRoute(entry)}
                    </PageBoundary>
                  </div>
                ))}
                {effectiveBusy && (
                  <div className="lj-saving" role="status">
                    <span />
                    正在保存…
                  </div>
                )}
                {toast && (
                  <div
                    className={`lj-toast ${toast.error ? 'error' : ''}`}
                    role={toast.error ? 'alert' : 'status'}
                  >
                    <Icon name={toast.error ? 'close' : 'check'} size={18} />
                    <span>{toast.message}</span>
                  </div>
                )}
              </main>
            </div>
          </CommitFeedbackContext.Provider>
        </BusyContext.Provider>
      </BackLayerContext.Provider>
    );
  },
);
