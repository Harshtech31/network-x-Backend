const express = require('express');
const { query, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache } = require('../config/redis');
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

// Create text indexes for search
async function createSearchIndexes() {
  try {
    await User.collection.createIndex(
      { 
        firstName: 'text', 
        lastName: 'text', 
        username: 'text', 
        skills: 'text',
        interests: 'text',
        department: 'text',
        bio: 'text'
      },
      { weights: { 
          firstName: 10, 
          lastName: 10, 
          username: 8,
          skills: 5,
          interests: 3,
          department: 2,
          bio: 1
        },
        name: 'user_search_index'
      }
    );
    
    console.log('Search indexes created successfully');
  } catch (error) {
    console.error('Error creating search indexes:', error);
  }
}

// Initialize search indexes when the server starts
createSearchIndexes();

// Perform search across different content types using MongoDB text search
const performSearch = async (searchQuery, searchType, filters, page = 1, limit = 10, userId) => {
  const results = {};
  const skip = (page - 1) * limit;
  
  // Search users
  if (searchType === 'users' || searchType === 'all') {
    try {
      const userQuery = { isActive: { $ne: false } };
      
      if (searchQuery && searchQuery.trim()) {
        userQuery.$text = { $search: searchQuery.trim() };
      }
      
      // Apply filters
      if (filters.department) {
        userQuery.department = filters.department;
      }
      if (filters.year) {
        userQuery.year = parseInt(filters.year);
      }
      if (filters.skills && filters.skills.length > 0) {
        userQuery.skills = { $in: filters.skills };
      }
      
      const sortCriteria = searchQuery && searchQuery.trim() 
        ? { score: { $meta: 'textScore' }, rating: -1, createdAt: -1 }
        : { rating: -1, createdAt: -1 };
      
      const [users, totalUsers] = await Promise.all([
        User.find(userQuery)
          .select('firstName lastName username profileImage department year skills interests rating isVerified')
          .sort(sortCriteria)
          .skip(searchType === 'all' ? 0 : skip)
          .limit(searchType === 'all' ? 5 : limit),
        User.countDocuments(userQuery)
      ]);
      
      results.users = {
        data: users,
        total: totalUsers,
        hasMore: searchType === 'all' ? totalUsers > 5 : totalUsers > (skip + users.length)
      };
    } catch (error) {
      console.error('Users search error:', error);
      results.users = { data: [], total: 0, hasMore: false };
    }
  }
  
  // Search posts in DynamoDB
  if (searchType === 'posts' || searchType === 'all') {
    try {
      const posts = await queryItems('Posts', {
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': 'POST'
        },
        ScanIndexForward: false,
        Limit: searchType === 'all' ? 5 : limit
      });
      
      let filteredPosts = posts;
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.toLowerCase();
        filteredPosts = posts.filter(post => 
          post.content?.toLowerCase().includes(searchTerm) ||
          post.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
        );
      }
      
      results.posts = {
        data: filteredPosts.slice(0, searchType === 'all' ? 5 : limit),
        total: filteredPosts.length,
        hasMore: filteredPosts.length > (searchType === 'all' ? 5 : limit)
      };
    } catch (error) {
      console.error('Posts search error:', error);
      results.posts = { data: [], total: 0, hasMore: false };
    }
  }
  
  // Search projects in DynamoDB
  if (searchType === 'projects' || searchType === 'all') {
    try {
      const projects = await queryItems('Projects', {
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        ExpressionAttributeValues: {
          ':gsi1pk': 'PROJECT'
        },
        ScanIndexForward: false,
        Limit: searchType === 'all' ? 5 : limit
      });
      
      let filteredProjects = projects;
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = searchQuery.toLowerCase();
        filteredProjects = projects.filter(project => 
          project.title?.toLowerCase().includes(searchTerm) ||
          project.description?.toLowerCase().includes(searchTerm) ||
          project.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
        );
      }
      
      results.projects = {
        data: filteredProjects.slice(0, searchType === 'all' ? 5 : limit),
        total: filteredProjects.length,
        hasMore: filteredProjects.length > (searchType === 'all' ? 5 : limit)
      };
    } catch (error) {
      console.error('Projects search error:', error);
      results.projects = { data: [], total: 0, hasMore: false };
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
      return res.json([]);
    }
    
    const suggestions = [];
    const searchRegex = new RegExp(`^${q}`, 'i');
    
    // User suggestions
    if (type === 'users' || type === 'all') {
      const users = await User.find({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { username: searchRegex }
        ],
        isActive: { $ne: false }
      })
      .select('firstName lastName username profileImage')
      .limit(limit);
      
      suggestions.push(...users.map(user => ({
        type: 'user',
        id: user._id,
        text: `${user.firstName} ${user.lastName}`,
        subtitle: `@${user.username}`,
        image: user.profileImage
      })));
    }
    
    // Add popular search terms
    const popularTerms = [
      'javascript', 'python', 'react', 'nodejs', 'machine learning',
      'web development', 'mobile app', 'data science', 'ai', 'blockchain'
    ];
    
    const matchingTerms = popularTerms
      .filter(term => term.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5)
      .map(term => ({
        type: 'term',
        text: term,
        subtitle: 'Popular search'
      }));
    
    suggestions.push(...matchingTerms);
    
    // Sort by relevance (exact matches first, then partial matches)
    suggestions.sort((a, b) => {
      const aMatch = a.text.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      const bMatch = b.text.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      return aMatch - bMatch;
    });
    
    res.json(suggestions.slice(0, limit));

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
