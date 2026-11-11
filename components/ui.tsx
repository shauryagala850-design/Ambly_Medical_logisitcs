import type { ReactNode } from 'react';

export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'grey' | 'none';

const BADGE: Record<Tone, string> = {
  red: 'bg-alert-red text-white',
  amber: 'bg-alert-amber text-white',
  green: 'bg-alert-green text-white',
  blue: 'bg-pulse text-white',
  grey: 'bg-clinical text-carbon',
  none: 'bg-clinical/40 text-carbon',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${BADGE[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-clinical bg-white">
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-clinical px-4 py-2.5">
          <h2 className="text-lg font-bold text-pulse">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold text-pulse">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-carbon/70">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shows the ?error= or ?notice= message a form action redirected back with. */
export function Flash({ params }: { params: Record<string, string | undefined> }) {
  if (params.error) {
    return (
      <p role="alert" className="mb-4 rounded-md border-l-4 border-alert-red bg-alert-red/10 px-4 py-3 text-sm font-medium text-alert-red">
        {params.error}
      </p>
    );
  }
  if (params.notice) {
    return (
      <p role="status" className="mb-4 rounded-md border-l-4 border-alert-green bg-alert-green/10 px-4 py-3 text-sm font-medium text-alert-green">
        {params.notice}
      </p>
    );
  }
  return null;
}

export function Button({
  children,
  kind = 'primary',
  ...rest
}: { children: ReactNode; kind?: 'primary' | 'secondary' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: 'bg-pulse text-white hover:bg-pulse/90',
    secondary: 'border border-pulse text-pulse hover:bg-clinical/30',
    danger: 'border border-alert-red text-alert-red hover:bg-alert-red/10',
  }[kind];
  return (
    <button {...rest} className={`cursor-pointer rounded-md px-3.5 py-2 text-sm font-semibold ${styles} ${rest.className ?? ''}`}>
      {children}
    </button>
  );
}

export const linkClass = 'font-medium text-pulse underline underline-offset-2';
