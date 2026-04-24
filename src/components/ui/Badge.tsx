import React from 'react';
import { cn } from '../feed/PostCard';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'outline' | 'filled';
  color?: 'purple' | 'green' | 'amber' | 'blue' | 'gray' | 'red';
  className?: string;
  children?: React.ReactNode;
}

export function Badge({ className, variant = 'outline', color = 'gray', children, ...props }: BadgeProps) {
  const colors = {
    purple: 'border-brand-green/30 text-brand-green bg-brand-green/10',
    green: 'border-brand-green/30 text-brand-green bg-brand-green/10',
    amber: 'border-brand-yellow/30 text-brand-yellow bg-brand-yellow/10',
    blue: 'border-brand-green-soft/30 text-brand-green-soft bg-brand-green-soft/10',
    gray: 'border-brand-border text-brand-muted bg-brand-surface'
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
        colors[color],
        variant === 'filled' && 'border-transparent bg-opacity-20',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
