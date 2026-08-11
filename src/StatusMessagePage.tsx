import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";

export interface StatusMessageAction {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary";
}

// Standalone color tokens - deliberately NOT tied to any one app's design
// system (e.g. shadcn's hsl(var(--primary)) convention). Apps that want
// pixel-exact theme matching pass their own tokens via the `theme` prop;
// apps that pass nothing still get a reasonable, self-contained look.
export interface StatusMessageTheme {
  cardBackground?: string;
  cardBorder?: string;
  primary?: string;
  primaryForeground?: string;
  foreground?: string;
  mutedForeground?: string;
}

export interface StatusMessagePageProps {
  icon?: ReactNode;
  title: string;
  message: string;
  actions?: StatusMessageAction[];
  theme?: StatusMessageTheme;
  // Seconds to wait before this component's own entrance animation starts.
  // Set this to match/outlast any outer page-transition wrapper the host
  // app already fades this component in with - otherwise both animations
  // run at once and the outer fade masks this component's motion entirely.
  startDelay?: number;
}

const DEFAULT_THEME: Required<StatusMessageTheme> = {
  cardBackground: "#ffffff",
  cardBorder: "#e5e7eb",
  primary: "#2563eb",
  primaryForeground: "#ffffff",
  foreground: "#111827",
  mutedForeground: "#6b7280",
};

function buildStyles(
  theme: Required<StatusMessageTheme>,
): Record<string, CSSProperties> {
  const buttonBase: CSSProperties = {
    display: "inline-block",
    padding: "0.75rem 1.25rem",
    borderRadius: "0.75rem",
    fontWeight: 600,
    fontSize: "0.9375rem",
    textDecoration: "none",
    cursor: "pointer",
  };

  return {
    wrapper: {
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2.5rem 1rem",
    },
    card: {
      width: "100%",
      maxWidth: "28rem",
      borderRadius: "1rem",
      border: `1px solid ${theme.cardBorder}`,
      background: theme.cardBackground,
      padding: "2rem",
      textAlign: "center",
      boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
    },
    icon: {
      display: "flex",
      justifyContent: "center",
      marginBottom: "1rem",
      color: theme.primary,
    },
    title: {
      fontSize: "1.5rem",
      fontWeight: 600,
      color: theme.foreground,
      margin: "0 0 0.75rem",
    },
    message: {
      fontSize: "0.9375rem",
      color: theme.mutedForeground,
      lineHeight: 1.6,
      margin: "0 0 1.5rem",
    },
    actions: {
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
    },
    primaryButton: {
      ...buttonBase,
      background: theme.primary,
      color: theme.primaryForeground,
      border: "none",
    },
    secondaryButton: {
      ...buttonBase,
      background: "transparent",
      color: theme.foreground,
      border: `1px solid ${theme.cardBorder}`,
    },
  };
}

export default function StatusMessagePage({
  icon,
  title,
  message,
  actions = [],
  theme,
  startDelay = 0,
}: StatusMessagePageProps) {
  const styles = buildStyles({ ...DEFAULT_THEME, ...theme });

  return (
    <div style={styles.wrapper}>
      <motion.div
        style={styles.card}
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: startDelay }}
      >
        {icon && (
          <motion.div
            style={styles.icon}
            initial={{ opacity: 0, scale: 0.3, rotate: -15 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 12, delay: startDelay + 0.15 }}
          >
            {icon}
          </motion.div>
        )}
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.message}>{message}</p>
        {actions.length > 0 && (
          <motion.div
            style={styles.actions}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22, delay: startDelay + 0.3 }}
          >
            {actions.map((action, index) => {
              const kind =
                action.variant ?? (index === 0 ? "primary" : "secondary");
              const buttonStyle =
                kind === "primary"
                  ? styles.primaryButton
                  : styles.secondaryButton;
              return action.href ? (
                <a key={action.label} href={action.href} style={buttonStyle}>
                  {action.label}
                </a>
              ) : (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  style={buttonStyle}
                >
                  {action.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
