/**
 * Structured Logger
 * 
 * Uses Winston for JSON-structured logging with console and file transports.
 * Supports multiple log levels and contextual metadata.
 */

import winston from 'winston';
import { LOG_LEVEL } from '../config/shopify.js';

const { combine, timestamp, json, errors, printf, colorize } = winston.format;

// Console format for development (human-readable)
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'sku-generator' },
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  transports: [
    // File transport - always JSON
    new winston.transports.File({
      filename: 'logs/sku-generator-error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/sku-generator.log',
    }),
  ],
});

// Add console transport in non-production or when debugging
if (LOG_LEVEL === 'debug' || process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      consoleFormat
    ),
  }));
}

/**
 * Log operation progress
 * @param {string} operation - Operation name
 * @param {number} current - Current progress
 * @param {number} total - Total items
 * @param {object} extra - Extra metadata
 */
export function logProgress(operation, current, total, extra = {}) {
  const percentage = total > 0 ? ((current / total) * 100).toFixed(1) : 0;
  logger.info(`${operation} progress`, {
    current,
    total,
    percentage: `${percentage}%`,
    remaining: total - current,
    ...extra,
  });
}

/**
 * Log rate limit status
 * @param {object} throttleStatus - Current throttle status
 */
export function logRateLimit(throttleStatus) {
  logger.debug('Rate limit status', {
    maximumAvailable: throttleStatus.maximumAvailable,
    currentlyAvailable: throttleStatus.currentlyAvailable,
    restoreRate: throttleStatus.restoreRate,
    utilization: ((1 - throttleStatus.currentlyAvailable / throttleStatus.maximumAvailable) * 100).toFixed(1) + '%',
  });
}

export default logger;
