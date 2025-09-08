const redis = require('redis');

let redisClient = null;
let isConnected = false;

const connectRedis = async () => {
  try {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.log('Redis server connection refused');
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          console.log('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          console.log('Redis max retry attempts reached');
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    };

    if (process.env.REDIS_PASSWORD) {
      redisConfig.password = process.env.REDIS_PASSWORD;
    }

    redisClient = redis.createClient(redisConfig);

    redisClient.on('connect', () => {
      console.log('🔗 Connected to Redis server');
      isConnected = true;
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis connection error:', err);
      isConnected = false;
    });

    redisClient.on('end', () => {
      console.log('📴 Redis connection closed');
      isConnected = false;
    });

    return redisClient;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    return null;
  }
};

// Cache helper functions with fallback
const setCache = async (key, value, expireInSeconds = 3600) => {
  if (!isConnected || !redisClient) {
    console.warn('⚠️ Redis not available, skipping cache set');
    return false;
  }

  try {
    const serializedValue = JSON.stringify(value);
    await redisClient.setex(key, expireInSeconds, serializedValue);
    return true;
  } catch (error) {
    console.error('❌ Redis set error:', error);
    return false;
  }
};

const getCache = async (key) => {
  if (!isConnected || !redisClient) {
    console.warn('⚠️ Redis not available, cache miss');
    return null;
  }

  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('❌ Redis get error:', error);
    return null;
  }
};

const deleteCache = async (key) => {
  if (!isConnected || !redisClient) {
    console.warn('⚠️ Redis not available, skipping cache delete');
    return false;
  }

  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.error('❌ Redis delete error:', error);
    return false;
  }
};

const deleteCachePattern = async (pattern) => {
  if (!isConnected || !redisClient) {
    console.warn('⚠️ Redis not available, skipping pattern delete');
    return false;
  }

  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    return true;
  } catch (error) {
    console.error('❌ Redis pattern delete error:', error);
    return false;
  }
};

const incrementCache = async (key, expireInSeconds = 3600) => {
  if (!isConnected || !redisClient) {
    console.warn('⚠️ Redis not available, skipping increment');
    return 1;
  }

  try {
    const value = await redisClient.incr(key);
    if (value === 1) {
      await redisClient.expire(key, expireInSeconds);
    }
    return value;
  } catch (error) {
    console.error('❌ Redis increment error:', error);
    return 1;
  }
};

// Cache keys generator
const generateCacheKey = (prefix, ...parts) => {
  return `networkx:${prefix}:${parts.join(':')}`;
};

// Common cache keys
const CACHE_KEYS = {
  USER_PROFILE: (userId) => generateCacheKey('user', 'profile', userId),
  USER_POSTS: (userId, page) => generateCacheKey('user', 'posts', userId, page),
  POST_DETAILS: (postId) => generateCacheKey('post', 'details', postId),
  POST_COMMENTS: (postId, page) => generateCacheKey('post', 'comments', postId, page),
  PROJECT_DETAILS: (projectId) => generateCacheKey('project', 'details', projectId),
  PROJECT_MEMBERS: (projectId) => generateCacheKey('project', 'members', projectId),
  CLUB_DETAILS: (clubId) => generateCacheKey('club', 'details', clubId),
  CLUB_MEMBERS: (clubId) => generateCacheKey('club', 'members', clubId),
  EVENT_DETAILS: (eventId) => generateCacheKey('event', 'details', eventId),
  EVENT_ATTENDEES: (eventId) => generateCacheKey('event', 'attendees', eventId),
  FEED_HOME: (userId, page) => generateCacheKey('feed', 'home', userId, page),
  FEED_TRENDING: (page) => generateCacheKey('feed', 'trending', page),
  SEARCH_RESULTS: (query, filters, page) => generateCacheKey('search', 'results', query, JSON.stringify(filters), page),
  NOTIFICATIONS: (userId, page) => generateCacheKey('notifications', userId, page),
  CONVERSATIONS: (userId) => generateCacheKey('conversations', userId),
  CONVERSATION_MESSAGES: (conversationId, page) => generateCacheKey('conversation', 'messages', conversationId, page)
};

// Cache invalidation helpers
const invalidateUserCache = async (userId) => {
  await deleteCachePattern(`networkx:user:*:${userId}*`);
  await deleteCachePattern(`networkx:feed:home:${userId}:*`);
  await deleteCachePattern(`networkx:notifications:${userId}:*`);
};

const invalidatePostCache = async (postId, userId) => {
  await deleteCache(CACHE_KEYS.POST_DETAILS(postId));
  await deleteCachePattern(`networkx:post:comments:${postId}:*`);
  await deleteCachePattern(`networkx:user:posts:${userId}:*`);
  await deleteCachePattern(`networkx:feed:*`);
};

const invalidateProjectCache = async (projectId, creatorId) => {
  await deleteCache(CACHE_KEYS.PROJECT_DETAILS(projectId));
  await deleteCache(CACHE_KEYS.PROJECT_MEMBERS(projectId));
  await deleteCachePattern(`networkx:user:*:${creatorId}*`);
};

const invalidateClubCache = async (clubId, creatorId) => {
  await deleteCache(CACHE_KEYS.CLUB_DETAILS(clubId));
  await deleteCache(CACHE_KEYS.CLUB_MEMBERS(clubId));
  await deleteCachePattern(`networkx:user:*:${creatorId}*`);
};

const invalidateEventCache = async (eventId, creatorId) => {
  await deleteCache(CACHE_KEYS.EVENT_DETAILS(eventId));
  await deleteCache(CACHE_KEYS.EVENT_ATTENDEES(eventId));
  await deleteCachePattern(`networkx:user:*:${creatorId}*`);
};

module.exports = {
  connectRedis,
  redisClient: () => redisClient,
  isConnected: () => isConnected,
  setCache,
  getCache,
  deleteCache,
  deleteCachePattern,
  incrementCache,
  generateCacheKey,
  CACHE_KEYS,
  invalidateUserCache,
  invalidatePostCache,
  invalidateProjectCache,
  invalidateClubCache,
  invalidateEventCache
};
