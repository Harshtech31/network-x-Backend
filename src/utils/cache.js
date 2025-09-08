const redis = require('redis');

class CacheManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.init();
  }

  async init() {
    try {
      this.client = redis.createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
      });

      this.client.on('connect', () => {
        console.log('✅ Redis cache connected');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('❌ Redis cache error:', err);
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.warn('⚠️ Redis not available, using in-memory cache fallback');
      this.setupMemoryCache();
    }
  }

  setupMemoryCache() {
    // Fallback in-memory cache for development
    this.memoryCache = new Map();
    this.isConnected = true;
    
    // Clear memory cache every 30 minutes to prevent memory leaks
    setInterval(() => {
      this.memoryCache.clear();
    }, 30 * 60 * 1000);
  }

  async get(key) {
    try {
      if (!this.isConnected) return null;

      if (this.client) {
        const result = await this.client.get(key);
        return result ? JSON.parse(result) : null;
      } else if (this.memoryCache) {
        const item = this.memoryCache.get(key);
        if (item && item.expires > Date.now()) {
          return item.data;
        } else if (item) {
          this.memoryCache.delete(key);
        }
        return null;
      }
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 300) {
    try {
      if (!this.isConnected) return false;

      if (this.client) {
        await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
        return true;
      } else if (this.memoryCache) {
        this.memoryCache.set(key, {
          data: value,
          expires: Date.now() + (ttlSeconds * 1000)
        });
        return true;
      }
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async del(key) {
    try {
      if (!this.isConnected) return false;

      if (this.client) {
        await this.client.del(key);
        return true;
      } else if (this.memoryCache) {
        this.memoryCache.delete(key);
        return true;
      }
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async flush() {
    try {
      if (!this.isConnected) return false;

      if (this.client) {
        await this.client.flushAll();
        return true;
      } else if (this.memoryCache) {
        this.memoryCache.clear();
        return true;
      }
    } catch (error) {
      console.error('Cache flush error:', error);
      return false;
    }
  }

  // Generate cache keys for different types of data
  generateKey(type, ...params) {
    return `networkx:${type}:${params.join(':')}`;
  }

  // Specialized methods for common cache patterns
  async cacheSearchResults(query, type, filters, page, results) {
    const key = this.generateKey('search', query, type, JSON.stringify(filters), page);
    await this.set(key, results, 300); // 5 minutes TTL
    return key;
  }

  async getCachedSearchResults(query, type, filters, page) {
    const key = this.generateKey('search', query, type, JSON.stringify(filters), page);
    return await this.get(key);
  }

  async cacheFeedResults(userId, type, page, results) {
    const key = this.generateKey('feed', userId, type, page);
    await this.set(key, results, 180); // 3 minutes TTL for personalized content
    return key;
  }

  async getCachedFeedResults(userId, type, page) {
    const key = this.generateKey('feed', userId, type, page);
    return await this.get(key);
  }

  async cacheUserProfile(userId, profile) {
    const key = this.generateKey('user', userId);
    await this.set(key, profile, 600); // 10 minutes TTL
    return key;
  }

  async getCachedUserProfile(userId) {
    const key = this.generateKey('user', userId);
    return await this.get(key);
  }

  async invalidateUserCache(userId) {
    const patterns = [
      this.generateKey('user', userId),
      this.generateKey('feed', userId, '*'),
    ];
    
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        // For memory cache, we need to manually find matching keys
        if (this.memoryCache) {
          const keysToDelete = [];
          for (const key of this.memoryCache.keys()) {
            if (key.startsWith(pattern.replace('*', ''))) {
              keysToDelete.push(key);
            }
          }
          keysToDelete.forEach(key => this.memoryCache.delete(key));
        }
      } else {
        await this.del(pattern);
      }
    }
  }

  // Rate limiting helper
  async checkRateLimit(identifier, maxRequests = 100, windowSeconds = 3600) {
    const key = this.generateKey('ratelimit', identifier);
    const current = await this.get(key) || 0;
    
    if (current >= maxRequests) {
      return { allowed: false, remaining: 0, resetTime: windowSeconds };
    }
    
    await this.set(key, current + 1, windowSeconds);
    return { 
      allowed: true, 
      remaining: maxRequests - current - 1,
      resetTime: windowSeconds 
    };
  }
}

// Singleton instance
const cacheManager = new CacheManager();

module.exports = cacheManager;
