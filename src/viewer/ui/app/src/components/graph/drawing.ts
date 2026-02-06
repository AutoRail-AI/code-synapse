/**
 * Canvas drawing utilities for the Knowledge Graph visualization
 */

/**
 * Draw a hexagon shape (used for domain entities)
 */
export function drawHexagon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const px = x + radius * Math.cos(angle);
    const py = y + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Draw a cylinder shape (used for infrastructure entities)
 */
export function drawCylinder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  const height = radius * 1.4;
  const ellipseHeight = radius * 0.4;

  // Bottom ellipse
  ctx.beginPath();
  ctx.ellipse(x, y + height / 2, radius, ellipseHeight, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.beginPath();
  ctx.rect(x - radius, y - height / 2 + ellipseHeight / 2, radius * 2, height - ellipseHeight);
  ctx.fill();

  // Top ellipse
  ctx.beginPath();
  ctx.ellipse(x, y - height / 2 + ellipseHeight / 2, radius, ellipseHeight, 0, 0, Math.PI * 2);
}

/**
 * Draw a diamond shape (used for interfaces)
 */
export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
}

/**
 * Draw a square shape (used for files)
 */
export function drawSquare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number
): void {
  const size = radius * 1.5;
  ctx.beginPath();
  ctx.rect(x - size / 2, y - size / 2, size, size);
}

/**
 * Draw a bundled edge (curved, with thickness based on count)
 * Used when showing relationships between groups rather than individual nodes
 */
export function drawBundledEdge(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  count: number,
  color: string
): void {
  const thickness = Math.min(1 + Math.log2(count + 1) * 2, 8);

  // Calculate control point for curve
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  // Offset perpendicular to the line for curve
  const offset = dist * 0.15;
  const perpX = (-dy / dist) * offset;
  const perpY = (dx / dist) * offset;

  // Draw curved edge
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo(midX + perpX, midY + perpY, toX, toY);
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Draw arrow at end
  const angle = Math.atan2(toY - (midY + perpY), toX - (midX + perpX));
  const arrowLen = 8 + thickness;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - arrowLen * Math.cos(angle - 0.3), toY - arrowLen * Math.sin(angle - 0.3));
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - arrowLen * Math.cos(angle + 0.3), toY - arrowLen * Math.sin(angle + 0.3));
  ctx.stroke();
}

/**
 * Draw a straight edge with an arrow
 */
export function drawEdge(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
  lineWidth: number = 1
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  // Draw line
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Draw arrow
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const arrowLen = 6;
  const arrowX = toX - 10 * Math.cos(angle);
  const arrowY = toY - 10 * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(arrowX - arrowLen * Math.cos(angle - 0.4), arrowY - arrowLen * Math.sin(angle - 0.4));
  ctx.moveTo(arrowX, arrowY);
  ctx.lineTo(arrowX - arrowLen * Math.cos(angle + 0.4), arrowY - arrowLen * Math.sin(angle + 0.4));
  ctx.stroke();
}

/**
 * Draw a confidence ring around a node
 */
export function drawConfidenceRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  confidence: number
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * confidence);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Draw a highlight ring around a node
 */
export function drawHighlightRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Draw a label with background
 */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bgColor: string = 'rgba(15, 23, 42, 0.95)',
  textColor: string = '#ffffff',
  borderColor: string = '#475569'
): { width: number; height: number } {
  ctx.font = 'bold 11px sans-serif';
  const metrics = ctx.measureText(text);
  const width = metrics.width;
  const height = 16;
  const padding = 4;

  // Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(x - padding, y - 10, width + padding * 2, height);

  // Border
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - padding, y - 10, width + padding * 2, height);

  // Text
  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y);

  return { width, height };
}

/**
 * Draw a group bubble (cluster visualization)
 */
export function drawGroupBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  isHovered: boolean,
  isExpanded: boolean
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius + 10, 0, Math.PI * 2);
  ctx.fillStyle = isHovered ? `${color}30` : `${color}15`;
  ctx.fill();
  ctx.strokeStyle = isHovered ? color : `${color}80`;
  ctx.lineWidth = isHovered ? 3 : 2;
  ctx.setLineDash(isExpanded ? [] : [8, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}
