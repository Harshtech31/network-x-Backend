const express = require('express');
const { Op } = require('sequelize');
const { User, Post, Project, Event, Club } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { body, query, validationResult } = require('express-validator');
const cache = require('../utils/cache');

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

// Advanced search algorithm with full-text search capabilities
const performSearch = async (query, type, filters, page, limit, userId) => {
  const offset = (page - 1) * limit;
  const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);
  
  // Build search conditions for different content types
  const buildSearchConditions = (fields) => {
    return {
      [Op.or]: searchTerms.flatMap(term => 
        fields.map(field => ({
          [field]: {
            [Op.iLike]: `%${term}%`
          }
        }))
      )
    };
  };

  const results = {};

  // Search Users
  if (type === 'users' || type === 'all') {
    const userConditions = {
      [Op.and]: [
        buildSearchConditions(['firstName', 'lastName', 'username', 'bio', 'department']),
        { isActive: true },
        filters.department ? { department: filters.department } : {},
        filters.year ? { year: filters.year } : {},
        filters.skills ? {
          skills: {
            [Op.overlap]: filters.skills
          }
        } : {}
      ]
    };

    const users = await User.findAndCountAll({
      where: userConditions,
      attributes: [
        'id', 'firstName', 'lastName', 'username', 'bio', 
        'profileImage', 'department', 'year', 'skills', 
        'interests', 'rating', 'isVerified'
      ],
      limit: type === 'users' ? limit : Math.min(limit, 10),
      offset: type === 'users' ? offset : 0,
      order: [
        ['rating', 'DESC'],
        ['createdAt', 'DESC']
      ]
    });

    results.users = {
      data: users.rows,
      total: users.count,
      hasMore: users.count > (offset + users.rows.length)
    };
  }

  // Search Posts
  if (type === 'posts' || type === 'all') {
    const postConditions = {
      [Op.and]: [
        buildSearchConditions(['title', 'content']),
        { isPublic: true },
        filters.postType ? { type: filters.postType } : {},
        filters.tags ? {
          tags: {
            [Op.overlap]: filters.tags
          }
        } : {}
      ]
    };

    const posts = await Post.findAndCountAll({
      where: postConditions,
      include: [{
        model: User,
        as: 'author',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage', 'isVerified']
      }],
      limit: type === 'posts' ? limit : Math.min(limit, 10),
      offset: type === 'posts' ? offset : 0,
      order: [
        ['isPinned', 'DESC'],
        ['likes', 'DESC'],
        ['createdAt', 'DESC']
      ]
    });

    results.posts = {
      data: posts.rows,
      total: posts.count,
      hasMore: posts.count > (offset + posts.rows.length)
    };
  }

  // Search Projects
  if (type === 'projects' || type === 'all') {
    const projectConditions = {
      [Op.and]: [
        buildSearchConditions(['title', 'description']),
        { isPublic: true },
        filters.status ? { status: filters.status } : {},
        filters.techStack ? {
          techStack: {
            [Op.overlap]: filters.techStack
          }
        } : {}
      ]
    };

    const projects = await Project.findAndCountAll({
      where: projectConditions,
      include: [{
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      limit: type === 'projects' ? limit : Math.min(limit, 5),
      offset: type === 'projects' ? offset : 0,
      order: [
        ['priority', 'DESC'],
        ['createdAt', 'DESC']
      ]
    });

    results.projects = {
      data: projects.rows,
      total: projects.count,
      hasMore: projects.count > (offset + projects.rows.length)
    };
  }

  // Search Events
  if (type === 'events' || type === 'all') {
    const eventConditions = {
      [Op.and]: [
        buildSearchConditions(['title', 'description', 'location']),
        { isPublic: true },
        { startDate: { [Op.gte]: new Date() } }, // Only future events
        filters.category ? { category: filters.category } : {}
      ]
    };

    const events = await Event.findAndCountAll({
      where: eventConditions,
      include: [{
        model: User,
        as: 'organizer',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      limit: type === 'events' ? limit : Math.min(limit, 5),
      offset: type === 'events' ? offset : 0,
      order: [
        ['startDate', 'ASC']
      ]
    });

    results.events = {
      data: events.rows,
      total: events.count,
      hasMore: events.count > (offset + events.rows.length)
    };
  }

  // Search Clubs
  if (type === 'clubs' || type === 'all') {
    const clubConditions = {
      [Op.and]: [
        buildSearchConditions(['name', 'description']),
        { isActive: true },
        filters.category ? { category: filters.category } : {}
      ]
    };

    const clubs = await Club.findAndCountAll({
      where: clubConditions,
      include: [{
        model: User,
        as: 'president',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      limit: type === 'clubs' ? limit : Math.min(limit, 5),
      offset: type === 'clubs' ? offset : 0,
      order: [
        ['memberCount', 'DESC'],
        ['createdAt', 'DESC']
      ]
    });

    results.clubs = {
      data: clubs.rows,
      total: clubs.count,
      hasMore: clubs.count > (offset + clubs.rows.length)
    };
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
    const cachedResults = await cache.getCachedSearchResults(q, type, parsedFilters, parseInt(page));
    if (cachedResults) {
      return res.json({
        ...cachedResults,
        cached: true,
        searchTime: Date.now() - req.startTime
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
      results,
      searchTime: Date.now() - req.startTime
    };

    // Cache the results
    await cache.cacheSearchResults(q, type, parsedFilters, parseInt(page), responseData);

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
      const users = await User.findAll({
        where: {
          [Op.or]: [
            { firstName: { [Op.iLike]: `${q}%` } },
            { lastName: { [Op.iLike]: `${q}%` } },
            { username: { [Op.iLike]: `${q}%` } }
          ],
          isActive: true
        },
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage'],
        limit: Math.min(limit, 5)
      });

      suggestions.push(...users.map(user => ({
        type: 'user',
        id: user.id,
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
