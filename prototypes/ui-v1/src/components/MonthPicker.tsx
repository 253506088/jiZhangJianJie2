import { Icon } from './Icon';

export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const [year, value] = month.split('-').map(Number);
  const shift = (delta: number) => {
    const date = new Date(year, value - 1 + delta, 1);
    onChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };
  return (
    <div className="month-picker">
      <button className="icon-button" onClick={() => shift(-1)} aria-label="上个月">
        <Icon name="left" size={18} />
      </button>
      <label>
        <span>
          {year}
          <small>年</small> {value}
          <small>月</small>
        </span>
        <Icon name="down" size={14} />
        <input
          aria-label="选择月份"
          type="month"
          value={month}
          onChange={(event) => {
            if (/^\d{4}-\d{2}$/.test(event.target.value)) onChange(event.target.value);
          }}
        />
      </label>
      <button className="icon-button" onClick={() => shift(1)} aria-label="下个月">
        <Icon name="right" size={18} />
      </button>
    </div>
  );
}
