import { Component, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  resetState: unknown;
  resetContext: string;
  busy: boolean;
  onHome: () => void;
  onExport: () => void;
}

/** A rendering/statistics failure must not remove the user's path to a complete backup. */
export class PageBoundary extends Component<Props, { error: 'amount' | 'display' | null }> {
  state: { error: 'amount' | 'display' | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    const amount =
      error && typeof error === 'object' && 'code' in error && error.code === 'AMOUNT_OVERFLOW';
    return { error: amount ? 'amount' : 'display' };
  }

  componentDidUpdate(previous: Props) {
    if (
      this.state.error &&
      (previous.resetState !== this.props.resetState ||
        previous.resetContext !== this.props.resetContext)
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="lj-screen lj-page-error" role="alert">
        <span className="lj-brand-mark">
          <Icon name="book" size={29} />
        </span>
        <h1>
          {this.state.error === 'amount' ? '统计金额超过当前显示范围' : '这个页面暂时无法显示'}
        </h1>
        <p>
          原始账本仍在本机。你可以先导出完整备份，再重试或切换到其他页面；不会因为页面错误而自动清空数据。
        </p>
        <div>
          <button className="lj-primary" disabled={this.props.busy} onClick={this.props.onExport}>
            导出完整备份
          </button>
          <button className="lj-secondary" disabled={this.props.busy} onClick={this.props.onHome}>
            返回首页
          </button>
          <button
            className="lj-text-button"
            disabled={this.props.busy}
            onClick={() => this.setState({ error: null })}
          >
            重试显示
          </button>
        </div>
      </section>
    );
  }
}
