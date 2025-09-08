const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { query, validationResult } = require('express-validator');
const { scanItems } = require('../config/dynamodb');
const { setCache, getCache } = require('../config/redis');
const User = require('../models/mongodb/User');

const router = express.Router();

// Feed validation middleware
const feedValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
  query('type')
    .optional()
    .isIn(['all', 'posts', 'projects', 'events'])
    .withMessage('Invalid feed type')
];

// Calculate content relevance score based on user interests
const calculateRelevanceScore = (content, userInterests, userSkills, userConnections) => {
  let score = 0;
  
  // Base recency score (newer content gets higher score)
  const daysSinceCreated = Math.floor((Date.now() - new Date(content.createdAt)) / (1000 * 60 * 60 * 24));
  const recencyScore = Math.max(0, 10 - daysSinceCreated * 0.5);
  score += recencyScore;
  
  // Interest matching score
  if (content.tags && userInterests) {
    const matchingInterests = content.tags.filter(tag => 
      userInterests.some(interest => 
        interest.toLowerCase().includes(tag.toLowerCase()) || 
        tag.toLowerCase().includes(interest.toLowerCase())
      )
    );
    score += matchingInterests.length * 5;
  }
  
  // Skills matching score
  if (content.techStack && userSkills) {
    const matchingSkills = content.techStack.filter(tech => 
      userSkills.some(skill => 
        skill.toLowerCase().includes(tech.toLowerCase()) || 
        tech.toLowerCase().includes(skill.toLowerCase())
      )
    );
    score += matchingSkills.length * 3;
  }
  
  // Connection boost (content from connected users gets higher priority)
  if (userConnections.includes(content.authorId || content.ownerId)) {
    score += 8;
  }
  
  // Engagement score (likes, views, comments)
  if (content.likes) score += Math.min(content.likes * 0.1, 5);
  if (content.views) score += Math.min(content.views * 0.05, 3);
  
  // Content type bonuses
  if (content.type === 'collaboration' || content.type === 'project') score += 2;
  if (content.isPinned) score += 10;
  
  return Math.round(score * 10) / 10;
};

// Get personalized feed algorithm
const getPersonalizedFeed = async (userId, type, page, limit) => {
  const offset = (page - 1) * limit;
  
  // Get user data and connections
  const getUserFeedData = async (userId) => {
    const user = await User.findById(userId)
      .select('interests skills location');
    
    // Get user connections from collaborations table
    const collaborations = await scanItems(process.env.COLLABORATIONS_TABLE, {
      FilterExpression: '(userId = :userId OR collaboratorId = :userId) AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':status': 'accepted'
      }
    });
    
    const connectedUserIds = collaborations.map(collab => 
      collab.userId === userId ? collab.collaboratorId : collab.userId
    );
    
    return { user, connectedUserIds };
  };

  const { user, connectedUserIds } = await getUserFeedData(userId);

  const feedItems = [];
  
  // Get Posts
  if (type === 'all' || type === 'posts') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const posts = await scanItems(process.env.POSTS_TABLE, {
      FilterExpression: 'isPublic = :isPublic AND createdAt >= :thirtyDaysAgo',
      ExpressionAttributeValues: {
        ':isPublic': true,
        ':thirtyDaysAgo': thirtyDaysAgo
      }
    });
    
    // Sort by creation date descending and limit
    const sortedPosts = posts
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, type === 'posts' ? limit * 2 : limit);
    
    // Get author details for posts
    for (const post of sortedPosts) {
      try {
        const author = await User.findById(post.authorId)
          .select('firstName lastName username profileImage isVerified');
        
        const score = calculateRelevanceScore(
          post,
          user.interests,
          user.skills,
          connectedUserIds
        );
        
        feedItems.push({
          ...post,
          author: author || { firstName: 'Unknown', lastName: 'User', username: 'unknown' },
          contentType: 'post',
          relevanceScore: score,
          isFromConnection: connectedUserIds.includes(post.authorId)
        });
      } catch (error) {
        console.error('Error fetching post author:', error);
      }
    }
  }
  
  // Get Projects
  if (type === 'all' || type === 'projects') {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const projects = await scanItems(process.env.PROJECTS_TABLE, {
      FilterExpression: 'isPublic = :isPublic AND #status IN (:planning, :active, :recruiting) AND createdAt >= :sixtyDaysAgo',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':isPublic': true,
        ':planning': 'planning',
        ':active': 'active',
        ':recruiting': 'recruiting',
        ':sixtyDaysAgo': sixtyDaysAgo
      }
    });
    
    // Sort by creation date descending and limit
    const sortedProjects = projects
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, type === 'projects' ? limit * 2 : Math.floor(limit * 0.4));
    
    // Get owner details for projects
    for (const project of sortedProjects) {
      try {
        const owner = await User.findById(project.ownerId)
          .select('firstName lastName username profileImage');
        
        const score = calculateRelevanceScore(
          project,
          user.interests,
          user.skills,
          connectedUserIds
        );
        
        feedItems.push({
          ...project,
          owner: owner || { firstName: 'Unknown', lastName: 'User', username: 'unknown' },
          contentType: 'project',
          relevanceScore: score,
          isFromConnection: connectedUserIds.includes(project.ownerId)
        });
      } catch (error) {
        console.error('Error fetching project owner:', error);
      }
    }
  }
  
  // Get Events
  if (type === 'all' || type === 'events') {
    const now = new Date().toISOString();
    const events = await scanItems(process.env.EVENTS_TABLE, {
      FilterExpression: 'isPublic = :isPublic AND startDate >= :now',
      ExpressionAttributeValues: {
        ':isPublic': true,
        ':now': now
      }
    });
    
    // Sort by start date ascending and limit
    const sortedEvents = events
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
      .slice(0, type === 'events' ? limit * 2 : Math.floor(limit * 0.3));
    
    // Get organizer details for events
    for (const event of sortedEvents) {
      try {
        const organizer = await User.findById(event.organizerId)
          .select('firstName lastName username profileImage');
        
        const score = calculateRelevanceScore(
          event,
          user.interests,
          user.skills,
          connectedUserIds
        );
        
        feedItems.push({
          ...event,
          organizer: organizer || { firstName: 'Unknown', lastName: 'User', username: 'unknown' },
          contentType: 'event',
          relevanceScore: score,
          isFromConnection: connectedUserIds.includes(event.organizerId)
        });
      } catch (error) {
        console.error('Error fetching event organizer:', error);
      }
    }
  }
  
  // Sort by relevance score and apply pagination
  const sortedFeed = feedItems
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(offset, offset + limit);
  
  return {
    items: sortedFeed,
    hasMore: feedItems.length > offset + limit,
    totalItems: feedItems.length
  };
};

// GET /api/feed - Get personalized home feed
router.get('/', authenticateToken, feedValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }
    
    const {
      page = 1,
      limit = 20,
      type = 'all'
    } = req.query;
    
    // Check cache first
    const cacheKey = `feed:${req.user.id}:${type}:${page}`;
    const cachedFeed = await getCache(cacheKey);
    if (cachedFeed) {
      return res.json({
        ...cachedFeed,
        cached: true
      });
    }
    
    const feed = await getPersonalizedFeed(
      req.user.id,
      type,
      parseInt(page),
      parseInt(limit)
    );
    
    const responseData = {
      page: parseInt(page),
      limit: parseInt(limit),
      type,
      hasMore: feed.hasMore,
      totalItems: feed.totalItems,
      items: feed.items,
      generatedAt: new Date().toISOString()
    };

    // Cache the feed results for 10 minutes
    await setCache(cacheKey, responseData, 600);

    res.json(responseData);
    
  } catch (error) {
    console.error('Feed generation error:', error);
    res.status(500).json({
      error: 'Failed to generate feed',
      message: 'An error occurred while generating your personalized feed'
    });
  }
});

// GET /api/feed/trending - Get trending content
router.get('/trending', authenticateToken, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // Get trending posts (high engagement in last 7 days)
    const trendingPosts = await Post.findAll({
      where: {
        isPublic: true,
        createdAt: {
          [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      },
      include: [{
        model: User,
        as: 'author',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage', 'isVerified']
      }],
      order: [
        ['likes', 'DESC'],
        ['views', 'DESC'],
        ['createdAt', 'DESC']
      ],
      limit: Math.floor(limit * 0.6)
    });
    
    // Get trending projects
    const trendingProjects = await Project.findAll({
      where: {
        isPublic: true,
        status: {
          [Op.in]: ['active', 'recruiting']
        },
        createdAt: {
          [Op.gte]: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
        }
      },
      include: [{
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
      }],
      order: [
        ['priority', 'DESC'],
        ['createdAt', 'DESC']
      ],
      limit: Math.floor(limit * 0.4)
    });
    
    const trending = [
      ...trendingPosts.map(post => ({ ...post.toJSON(), contentType: 'post' })),
      ...trendingProjects.map(project => ({ ...project.toJSON(), contentType: 'project' }))
    ];
    
    res.json({
      trending: trending.slice(0, limit),
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Trending content error:', error);
    res.status(500).json({
      error: 'Failed to get trending content'
    });
  }
});

// GET /api/feed/recommendations - Get content recommendations
router.get('/recommendations', authenticateToken, async (req, res) => {
  try {
    const { type = 'users', limit = 5 } = req.query;
    
    const user = await User.findByPk(req.user.id, {
      attributes: ['interests', 'skills', 'department', 'year']
    });
    
    let recommendations = [];
    
    if (type === 'users') {
      // Recommend users with similar interests/skills
      recommendations = await User.findAll({
        where: {
          id: { [Op.ne]: req.user.id },
          isActive: true,
          [Op.or]: [
            { department: user.department },
            { year: user.year }
          ]
        },
        attributes: [
          'id', 'firstName', 'lastName', 'username', 'profileImage',
          'department', 'year', 'skills', 'interests', 'rating', 'isVerified'
        ],
        limit: parseInt(limit),
        order: [['rating', 'DESC']]
      });
    } else if (type === 'projects') {
      // Recommend projects based on user skills
      recommendations = await Project.findAll({
        where: {
          ownerId: { [Op.ne]: req.user.id },
          isPublic: true,
          status: 'recruiting'
        },
        include: [{
          model: User,
          as: 'owner',
          attributes: ['id', 'firstName', 'lastName', 'username', 'profileImage']
        }],
        limit: parseInt(limit),
        order: [['createdAt', 'DESC']]
      });
    }
    
    res.json({
      type,
      recommendations,
      basedOn: type === 'users' ? 'Similar interests and department' : 'Your skills and interests'
    });
    
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({
      error: 'Failed to get recommendations'
    });
  }
});

module.exports = router;
