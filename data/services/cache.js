/**
 * In-memory cache service with TTL support.
 */

class CacheEntry {
  constructor(value, ttl) {
    this.value = value;
    this.createdAt = Date.now();
    this.ttl = ttl;
  }

  isExpired() {
    if (this.ttl === null) {
      return false;
    }
    return Date.now() - this.createdAt > this.ttl;
  }
}

class CacheService {
  constructor(options = {}) {
    this.cache = new Map();
    this.defaultTtl = options.defaultTtl ?? 5 * 60 * 1000; // 5 minutes
    this.maxSize = options.maxSize ?? 1000;
    this.cleanupInterval = options.cleanupInterval ?? 60 * 1000; // 1 minute

    this.startCleanupTimer();
  }

  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get a value from the cache.
   * @param {string} key - The cache key
   * @returns {*} The cached value or undefined
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.isExpired()) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache.
   * @param {string} key - The cache key
   * @param {*} value - The value to cache
   * @param {number|null} [ttl] - Time to live in milliseconds (null for no expiry)
   */
  set(key, value, ttl = this.defaultTtl) {
    // Evict oldest entries if at max size
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    const entry = new CacheEntry(value, ttl);
    this.cache.set(key, entry);
  }

  /**
   * Check if a key exists and is not expired.
   * @param {string} key - The cache key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    if (entry.isExpired()) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a key from the cache.
   * @param {string} key - The cache key
   * @returns {boolean} Whether the key was deleted
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache.
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache.
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }

  /**
   * Remove all expired entries.
   * @returns {number} Number of entries removed
   */
  cleanup() {
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (entry.isExpired()) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get or set a cached value.
   * @param {string} key - The cache key
   * @param {function} factory - Function to create the value if not cached
   * @param {number|null} [ttl] - Time to live
   * @returns {Promise<*>}
   */
  async getOrSet(key, factory, ttl = this.defaultTtl) {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Get all keys in the cache.
   * @returns {string[]}
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache statistics.
   * @returns {Object}
   */
  stats() {
    let expired = 0;
    let active = 0;

    for (const entry of this.cache.values()) {
      if (entry.isExpired()) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.cache.size,
      active,
      expired,
      maxSize: this.maxSize,
    };
  }
}

/**
 * Create a new cache service instance.
 * @param {Object} [options]
 * @returns {CacheService}
 */
function createCache(options) {
  return new CacheService(options);
}

module.exports = {
  CacheService,
  createCache,
};
