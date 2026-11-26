import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { SortDirection } from '../utils/network';

interface SortIndicatorProps {
  active: boolean;
  direction: SortDirection;
}

export const SortIndicator: React.FC<SortIndicatorProps> = ({ active, direction }) => {
  if (!active) {
    return <ArrowUpDown size={12} style={{ opacity: 0.3, marginLeft: '4px' }} />;
  }
  return direction === 'asc' ? (
    <ArrowUp size={12} style={{ color: 'var(--accent-blue)', marginLeft: '4px' }} />
  ) : (
    <ArrowDown size={12} style={{ color: 'var(--accent-blue)', marginLeft: '4px' }} />
  );
};
