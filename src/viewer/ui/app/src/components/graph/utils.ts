/**
 * Utility functions for the Knowledge Graph visualization
 */

/**
 * Extract directory from a node label or path
 * Examples:
 * - "src/auth/login.ts" -> "src/auth"
 * - "AuthService.login" -> "AuthService"
 * - "simpleFunction" -> "root"
 */
export function getNodeDirectory(label: string): string {
  // Handle file paths like "src/auth/login.ts" -> "src/auth"
  if (label.includes('/')) {
    const parts = label.split('/');
    return parts.slice(0, -1).join('/') || 'root';
  }
  // Handle class/function names, try to infer from naming
  if (label.includes('.')) {
    return label.split('.')[0];
  }
  return 'root';
}

/**
 * Get feature group name from a node
 * Uses featureContext if available, otherwise infers from directory
 */
export function getFeatureGroup(node: { featureContext?: string; label: string }): string {
  if (node.featureContext && node.featureContext !== 'Unknown') {
    return node.featureContext;
  }
  // Fallback: use first part of label or directory
  const dir = getNodeDirectory(node.label);
  if (dir !== 'root') {
    const parts = dir.split('/');
    return parts[parts.length - 1] || 'Other';
  }
  return 'Other';
}

/**
 * Check if two labels would overlap on the canvas
 * Used for collision detection when drawing labels
 */
export function labelsOverlap(
  x1: number, y1: number, w1: number,
  x2: number, y2: number, w2: number,
  padding: number = 5
): boolean {
  const h = 16; // Approximate label height
  return !(x1 + w1 + padding < x2 || x2 + w2 + padding < x1 ||
           y1 + h + padding < y2 || y2 + h + padding < y1);
}

/**
 * Generate a consistent color from a string (for group coloring)
 */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Calculate the angle between two points
 */
export function calculateAngle(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

/**
 * Calculate distance between two points
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
