import type { ComponentType, ReactNode } from 'react';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
}) {
  return (
    <div className="bg-white/90 border border-[#e8dfd5] p-5 lg:p-6 rounded-2xl shadow-sm dark:bg-stone-900/90 dark:border-stone-800">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <span className="inline-flex text-[9px] uppercase tracking-widest bg-stone-100 text-stone-600 px-2.5 py-0.5 rounded font-bold dark:bg-stone-800 dark:text-stone-300">
              {eyebrow}
            </span>
          )}
          <h2 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
            {Icon && <Icon className="w-5 h-5 text-[#4e0e15] dark:text-amber-300" />}
            {title}
          </h2>
          {description && (
            <p className="text-xs text-stone-400 font-semibold mt-0.5 max-w-3xl">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('bg-white/90 border border-[#e8dfd5] rounded-2xl shadow-sm dark:bg-stone-900/90 dark:border-stone-800', className)}>
      {(title || actions) && (
        <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-start justify-between gap-3 dark:border-stone-800">
          <div className="min-w-0">
            {title && (
              <h3 className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
                {Icon && <Icon className="w-4 h-4" />}
                {title}
              </h3>
            )}
            {subtitle && <p className="text-[11px] text-stone-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'brand',
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  onClick?: () => void;
}) {
  const tones = {
    brand: 'border-l-[#4e0e15] text-[#4e0e15] dark:text-amber-200',
    success: 'border-l-emerald-600 text-emerald-700 dark:text-emerald-300',
    warning: 'border-l-amber-500 text-amber-700 dark:text-amber-300',
    danger: 'border-l-rose-600 text-rose-700 dark:text-rose-300',
    info: 'border-l-sky-600 text-sky-700 dark:text-sky-300',
    neutral: 'border-l-stone-300 text-stone-800 dark:text-stone-100',
  };
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="block text-[10px] font-mono font-black uppercase tracking-[0.16em] text-stone-400">
          {label}
        </span>
        {Icon && (
          <span className="rounded-xl border border-stone-200 bg-stone-50 p-2 text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-amber-200">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <strong className={cx('mt-3 block text-2xl lg:text-3xl font-black leading-none', tones[tone].split(' ').slice(1).join(' '))}>
        {value}
      </strong>
      {detail && (
        <span className="mt-2 block text-[11px] font-semibold leading-snug text-stone-500 dark:text-stone-400">
          {detail}
        </span>
      )}
    </>
  );
  const className = cx(
    'rounded-2xl border border-[#e8dfd5] border-l-4 bg-white/92 p-4 text-left shadow-sm transition-smooth dark:border-stone-800 dark:bg-stone-900/90',
    tones[tone].split(' ')[0],
    onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:border-stone-700',
    brand: 'bg-rose-100 text-[#4e0e15] border-rose-200 dark:bg-rose-950/30 dark:text-amber-100 dark:border-rose-900',
    success: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900',
    warning: 'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900',
    danger: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
    info: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900',
  };
  return (
    <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide', tones[tone])}>
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  tone = 'brand',
  label,
}: {
  value: number;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'info';
  label?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const tones = {
    brand: 'bg-[#4e0e15]',
    success: 'bg-emerald-600',
    warning: 'bg-amber-500',
    danger: 'bg-rose-600',
    info: 'bg-sky-600',
  };
  return (
    <div>
      {label && (
        <div className="mb-1 flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wide text-stone-400">
          <span>{label}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
        <div className={cx('h-full rounded-full transition-all duration-500', tones[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-12 px-4 text-stone-400">
      {Icon && <Icon className="w-10 h-10 mx-auto mb-3 opacity-40" />}
      <h3 className="text-sm font-bold text-stone-600 dark:text-stone-300">{title}</h3>
      {description && <p className="text-xs mt-1 max-w-md mx-auto leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function FormSection({
  title,
  description,
  icon: Icon,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-stone-50/50 p-4 dark:border-stone-800 dark:bg-stone-950/30">
      <div className="mb-3 flex items-start gap-2">
        {Icon && (
          <span className="rounded-xl border border-stone-200 bg-white p-2 text-[#4e0e15] dark:border-stone-800 dark:bg-stone-900 dark:text-amber-200">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h4 className="text-xs font-black uppercase tracking-wide text-stone-800 dark:text-amber-100">{title}</h4>
          {description && <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">{description}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
      {footer && <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">{footer}</div>}
    </section>
  );
}

export function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest">
      {children}
      {required && <span className="ml-1 text-rose-600">*</span>}
    </label>
  );
}

export function InlineNotice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200',
    danger: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200',
    neutral: 'border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-300',
  };
  return (
    <div className={cx('rounded-xl border px-3 py-2 text-[11px] font-semibold leading-relaxed', tones[tone])}>
      {children}
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  type = 'button',
  tone = 'brand',
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  tone?: 'brand' | 'secondary' | 'danger';
  disabled?: boolean;
  className?: string;
}) {
  const tones = {
    brand: 'bg-[#4e0e15] hover:bg-[#34070a] text-amber-50',
    secondary: 'bg-stone-100 hover:bg-stone-200 text-stone-700 dark:bg-stone-800 dark:hover:bg-stone-700 dark:text-stone-100',
    danger: 'bg-rose-700 hover:bg-rose-800 text-white',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx('inline-flex items-center justify-center rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed', tones[tone], className)}
    >
      {children}
    </button>
  );
}
