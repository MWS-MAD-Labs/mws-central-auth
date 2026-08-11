import type { CSSProperties, ReactNode } from 'react';

export interface StatusMessageAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: 'primary' | 'secondary';
}

export interface StatusMessagePageProps {
  icon?: ReactNode;
  title: string;
  message: string;
  actions?: StatusMessageAction[];
}

export default function StatusMessagePage({ icon, title, message, actions = [] }: StatusMessagePageProps) {
  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        {icon && <div style={styles.icon}>{icon}</div>}
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.message}>{message}</p>
        {actions.length > 0 && (
          <div style={styles.actions}>
            {actions.map((action, index) => {
              const kind = action.variant ?? (index === 0 ? 'primary' : 'secondary');
              const buttonStyle = kind === 'primary' ? styles.primaryButton : styles.secondaryButton;
              return action.href ? (
                <a key={action.label} href={action.href} style={buttonStyle}>
                  {action.label}
                </a>
              ) : (
                <button key={action.label} type="button" onClick={action.onClick} style={buttonStyle}>
                  {action.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2.5rem 1rem',
  },
  card: {
    width: '100%',
    maxWidth: '28rem',
    borderRadius: '1rem',
    border: '1px solid hsl(var(--border, 214 32% 91%) / 0.4)',
    background: 'hsl(var(--card, 0 0% 100%) / 0.6)',
    backdropFilter: 'blur(12px)',
    padding: '2rem',
    textAlign: 'center',
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  },
  icon: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '1rem',
    color: 'hsl(var(--primary, 221 83% 53%))',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 600,
    color: 'hsl(var(--foreground, 222 47% 11%))',
    margin: '0 0 0.75rem',
  },
  message: {
    fontSize: '0.9375rem',
    color: 'hsl(var(--muted-foreground, 215 16% 47%))',
    lineHeight: 1.6,
    margin: '0 0 1.5rem',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  primaryButton: {
    display: 'inline-block',
    padding: '0.75rem 1.25rem',
    borderRadius: '0.75rem',
    background: 'hsl(var(--primary, 221 83% 53%))',
    color: 'hsl(var(--primary-foreground, 0 0% 100%))',
    fontWeight: 600,
    fontSize: '0.9375rem',
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  secondaryButton: {
    display: 'inline-block',
    padding: '0.75rem 1.25rem',
    borderRadius: '0.75rem',
    background: 'transparent',
    color: 'hsl(var(--foreground, 222 47% 11%))',
    fontWeight: 600,
    fontSize: '0.9375rem',
    textDecoration: 'none',
    border: '1px solid hsl(var(--border, 214 32% 91%) / 0.4)',
    cursor: 'pointer',
  },
};
