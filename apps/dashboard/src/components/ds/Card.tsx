import type { CSSProperties, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Bordered panel — the workhorse container from the design. */
export function Card({ children, className = '', style }: CardProps) {
  return (
    <div className={`ds-card ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ds-card-hd ${className}`.trim()}>{children}</div>;
}

export function CardBody({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`ds-card-bd ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}
