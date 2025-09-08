const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { query, validationResult } = require('express-validator');
const { scanItems } = require('../config/dynamodb');
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

// Advanced search algorithm with full-text search capabilities
const performSearch = async (query, type, filters, page, limit, userId) => {
  const offset = (page - 1) * limit;
  const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);
  
  const results = {};
  const POSTS_TABLE = process.env.DYNAMODB_POSTS_TABLE || 'networkx-posts';
  const PROJECTS_TABLE = process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects';
  const CLUBS_TABLE = process.env.DYNAMODB_CLUBS_TABLE || 'networkx-clubs';
  const EVENTS_TABLE = process.env.DYNAMODB_EVENTS_TABLE || 'networkx-events';

  // Search Users (MongoDB)
  if (type === 'users' || type === 'all') {
    const searchRegex = new RegExp(searchTerms.join('|'), 'i');
    const userQuery = {
      $and: [
        {
          $or: [
            { firstName: searchRegex },
            { lastName: searchRegex },
            { username: searchRegex },
            { bio: searchRegex },
            { department: searchRegex }
          ]
        },
        { isActive: { $ne: false } }
      ]
    };

    if (filters.department) userQuery.$and.push({ department: filters.department });
    if (filters.year) userQuery.$and.push({ year: filters.year });
    if (filters.skills) userQuery.$and.push({ skills: { $in: filters.skills } });

    const users = await User.find(userQuery)
      .select('firstName lastName username bio profileImage department year skills interests rating isVerified')
      .limit(type === 'users' ? limit : Math.min(limit, 10))
      .skip(type === 'users' ? offset : 0)
      .sort({ rating: -1, createdAt: -1 });

    const totalUsers = await User.countDocuments(userQuery);

    results.users = {
      data: users,
      total: totalUsers,
      hasMore: totalUsers > (offset + users.length)
    };
  }

  // Search Posts (DynamoDB)
  if (type === 'posts' || type === 'all') {
    try {
      const posts = await scanItems(POSTS_TABLE, null, {}, type === 'posts' ? limit : Math.min(limit, 10));
      
      // Filter posts based on search terms
      const filteredPosts = posts.filter(post => {
        const matchesSearch = searchTerms.some(term => 
          (post.title && post.title.toLowerCase().includes(term)) ||
          (post.content && post.content.toLowerCase().includes(term))
        );
        const matchesFilters = (!filters.postType || post.type === filters.postType) &&
                              (!filters.tags || (post.tags && post.tags.some(tag => filters.tags.includes(tag))));
        return matchesSearch && matchesFilters && post.isPublic !== false;
      });

      // Get user details for posts
      const postsWithUsers = await Promise.all(
        filteredPosts.slice(0, type === 'posts' ? limit : Math.min(limit, 10)).map(async (post) => {
          const author = await User.findById(post.userId).select('firstName lastName username profileImage isVerified');
          return { ...post, author };
        })
      );

      results.posts = {
        data: postsWithUsers,
        total: filteredPosts.length,
        hasMore: filteredPosts.length > postsWithUsers.length
      };
    } catch (error) {
      console.error('Posts search error:', error);
      results.posts = { data: [], total: 0, hasMore: false };
    }
  }

  // Search Projects (DynamoDB)
  if (type === 'projects' || type === 'all') {
    try {
      const projects = await scanItems(PROJECTS_TABLE, null, {}, type === 'projects' ? limit : Math.min(limit, 5));
      
      const filteredProjects = projects.filter(project => {
        const matchesSearch = searchTerms.some(term => 
          (project.title && project.title.toLowerCase().includes(term)) ||
          (project.description && project.description.toLowerCase().includes(term))
        );
        const matchesFilters = (!filters.status || project.status === filters.status) &&
                              (!filters.techStack || (project.techStack && project.techStack.some(tech => filters.techStack.includes(tech))));
        return matchesSearch && matchesFilters && project.isPublic !== false;
      });

      const projectsWithUsers = await Promise.all(
        filteredProjects.slice(0, type === 'projects' ? limit : Math.min(limit, 5)).map(async (project) => {
          const owner = await User.findById(project.ownerId).select('firstName lastName username profileImage');
          return { ...project, owner };
        })
      );

      results.projects = {
        data: projectsWithUsers,
        total: filteredProjects.length,
        hasMore: filteredProjects.length > projectsWithUsers.length
      };
    } catch (error) {
      console.error('Projects search error:', error);
      results.projects = { data: [], total: 0, hasMore: false };
    }
  }

  // Search Events (DynamoDB)
  if (type === 'events' || type === 'all') {
    try {
      const events = await scanItems(EVENTS_TABLE, null, {}, type === 'events' ? limit : Math.min(limit, 5));
      
      const filteredEvents = events.filter(event => {
        const matchesSearch = searchTerms.some(term => 
          (event.title && event.title.toLowerCase().includes(term)) ||
          (event.description && event.description.toLowerCase().includes(term)) ||
          (event.location && event.location.toLowerCase().includes(term))
        );
        const matchesFilters = (!filters.category || event.category === filters.category);
        const isFuture = new Date(event.startDate) >= new Date();
        return matchesSearch && matchesFilters && event.isPublic !== false && isFuture;
      });

      const eventsWithUsers = await Promise.all(
        filteredEvents.slice(0, type === 'events' ? limit : Math.min(limit, 5)).map(async (event) => {
          const organizer = await User.findById(event.organizerId).select('firstName lastName username profileImage');
          return { ...event, organizer };
        })
      );

      results.events = {
        data: eventsWithUsers,
        total: filteredEvents.length,
        hasMore: filteredEvents.length > eventsWithUsers.length
      };
    } catch (error) {
      console.error('Events search error:', error);
      results.events = { data: [], total: 0, hasMore: false };
    }
  }

  // Search Clubs (DynamoDB)
  if (type === 'clubs' || type === 'all') {
    try {
      const clubs = await scanItems(CLUBS_TABLE, null, {}, type === 'clubs' ? limit : Math.min(limit, 5));
      
      const filteredClubs = clubs.filter(club => {
        const matchesSearch = searchTerms.some(term => 
          (club.name && club.name.toLowerCase().includes(term)) ||
          (club.description && club.description.toLowerCase().includes(term))
        );
        const matchesFilters = (!filters.category || club.category === filters.category);
        return matchesSearch && matchesFilters && club.isActive !== false;
      });

      const clubsWithUsers = await Promise.all(
        filteredClubs.slice(0, type === 'clubs' ? limit : Math.min(limit, 5)).map(async (club) => {
          const president = await User.findById(club.presidentId).select('firstName lastName username profileImage');
          return { ...club, president };
        })
      );

      results.clubs = {
        data: clubsWithUsers,
        total: filteredClubs.length,
        hasMore: filteredClubs.length > clubsWithUsers.length
      };
    } catch (error) {
      console.error('Clubs search error:', error);
      results.clubs = { data: [], total: 0, hasMore: false };
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
