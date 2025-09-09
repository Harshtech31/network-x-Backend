const express = require('express');
const { query, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS } = require('../config/redis');
const { searchDocuments, getSearchSuggestions } = require('../config/opensearch');
const User = require('../models/mongodb/User');

const router = express.Router();

// Search validation middleware
const searchValidation = [
  query('q')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search query must be between 1 and 100 characters'),
  query('type')
    .optional()
    .isIn(['users', 'posts', 'projects', 'events', 'clubs', 'all'])
    .withMessage('Invalid search type'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  query('filters')
    .optional()
    .isJSON()
    .withMessage('Filters must be valid JSON')
];

// Perform search across different content types
const performSearch = async (searchQuery, searchType, filters, page, limit, userId) => {
  const results = {};
  const offset = (page - 1) * limit;

  // Search users
  if (searchType === 'users' || searchType === 'all') {
    try {
      const userQuery = { isActive: { $ne: false } };
      
      if (searchQuery) {
        userQuery.$or = [
          { firstName: { $regex: searchQuery, $options: 'i' } },
          { lastName: { $regex: searchQuery, $options: 'i' } },
          { username: { $regex: searchQuery, $options: 'i' } },
          { skills: { $in: [new RegExp(searchQuery, 'i')] } },
          { interests: { $in: [new RegExp(searchQuery, 'i')] } }
        ];
      }
      
      if (filters.department) userQuery.department = filters.department;
      if (filters.year) userQuery.year = filters.year;
      if (filters.skills) userQuery.skills = { $in: filters.skills };

      const users = await User.find(userQuery)
        .select('firstName lastName username profileImage department year skills interests rating isVerified')
        .skip(searchType === 'all' ? 0 : offset)
        .limit(searchType === 'all' ? 10 : limit)
        .sort({ rating: -1, createdAt: -1 });

      const totalUsers = await User.countDocuments(userQuery);

      results.users = {
        data: users,
        total: totalUsers,
        hasMore: totalUsers > users.length
      };
    } catch (error) {
      console.error('Users search error:', error);
      results.users = { data: [], total: 0, hasMore: false };
    }
  }

  return results;
};

// GET /api/search - Main search endpoint
router.get('/', authenticateToken, searchValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const {
      q = '',
      type = 'all',
      page = 1,
      limit = 20,
      filters = '{}'
    } = req.query;

    if (!q.trim() && type === 'all') {
      return res.status(400).json({
        error: 'Search query is required'
      });
    }

    const parsedFilters = JSON.parse(filters);
    
    // Check cache first
    const cacheKey = `search:${q}:${type}:${JSON.stringify(parsedFilters)}:${page}`;
    const cachedResults = await getCache(cacheKey);
    if (cachedResults) {
      return res.json({
        ...cachedResults,
        cached: true
      });
    }

    const results = await performSearch(
      q,
      type,
      parsedFilters,
      parseInt(page),
      parseInt(limit),
      req.user.id
    );

    // Calculate total results across all types for 'all' search
    let totalResults = 0;
    if (type === 'all') {
      Object.values(results).forEach(result => {
        totalResults += result.total;
      });
    } else {
      totalResults = results[type]?.total || 0;
    }

    const responseData = {
      query: q,
      type,
      page: parseInt(page),
      limit: parseInt(limit),
      totalResults,
      results
    };

    // Cache the results for 5 minutes
    await setCache(cacheKey, responseData, 300);

    res.json(responseData);

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: 'An error occurred while searching'
    });
  }
});

// GET /api/search/suggestions - Search suggestions/autocomplete
router.get('/suggestions', authenticateToken, async (req, res) => {
  try {
    const { q, type = 'all', limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const suggestions = [];

    // Get user suggestions
    if (type === 'users' || type === 'all') {
      const searchRegex = new RegExp(`^${q}`, 'i');
      const users = await User.find({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { username: searchRegex }
        ],
        isActive: { $ne: false }
      })
      .select('firstName lastName username profileImage')
      .limit(Math.min(limit, 5));

      suggestions.push(...users.map(user => ({
        type: 'user',
        id: user._id,
        text: `${user.firstName} ${user.lastName}`,
        subtitle: `@${user.username}`,
        image: user.profileImage
      })));
    }

    // Get popular search terms (you can implement this based on search analytics)
    const popularTerms = [
      'javascript', 'python', 'react', 'nodejs', 'machine learning',
      'web development', 'mobile app', 'data science', 'ai', 'blockchain'
    ];

    const matchingTerms = popularTerms
      .filter(term => term.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 3)
      .map(term => ({
        type: 'term',
        text: term,
        subtitle: 'Popular search'
      }));

    suggestions.push(...matchingTerms);

    res.json({
      query: q,
      suggestions: suggestions.slice(0, limit)
    });

  } catch (error) {
    console.error('Search suggestions error:', error);
    res.status(500).json({
      error: 'Failed to get suggestions'
    });
  }
});

// GET /api/search/trending - Get trending searches
router.get('/trending', authenticateToken, async (req, res) => {
  try {
    // This would typically come from analytics/search logs
    // For now, return static trending topics
    const trending = [
      { term: 'machine learning', count: 1250 },
      { term: 'react native', count: 980 },
      { term: 'data science', count: 875 },
      { term: 'web development', count: 750 },
      { term: 'python', count: 650 },
      { term: 'javascript', count: 600 },
      { term: 'mobile app', count: 550 },
      { term: 'blockchain', count: 450 },
      { term: 'ai research', count: 400 },
      { term: 'startup', count: 350 }
    ];

    res.json({
      trending: trending.slice(0, 10),
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Trending search error:', error);
    res.status(500).json({
      error: 'Failed to get trending searches'
    });
  }
});

module.exports = router;
