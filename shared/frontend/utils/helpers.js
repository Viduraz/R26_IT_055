// shared/frontend/utils/helpers.js
// Common utility functions shared across all frontend modules.

/**
 * Format an ISO date string to a readable local date-time.
 * @param {string} isoString
 * @returns {string}
 */
export const formatDate = (isoString) => {
  if (!isoString) return "N/A";
  return new Date(isoString).toLocaleString();
};

/**
 * Truncate a string to a maximum length.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export const truncate = (str, maxLen = 50) => {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
};

/**
 * Build a query string from a plain object.
 * @param {Record<string, any>} params
 * @returns {string}
 */
export const buildQueryString = (params = {}) => {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
};
