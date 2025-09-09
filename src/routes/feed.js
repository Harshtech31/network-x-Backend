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
  if (userConnections.includes(content.userId || content.ownerId || content.creatorId || content.organizerId)) {
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
    const collaborations = await scanItems(
      process.env.DYNAMODB_COLLABORATIONS_TABLE || 'networkx-collaborations',
      null,  // filterExpression would go in params if needed
      {}     // expressionAttributeValues would go in params
    );
    
    const accepted = (collaborations || []).filter(collab => 
      (collab.userId === userId || collab.collaboratorId === userId) && collab.status === 'accepted'
    );
    const connectedUserIds = accepted.map(collab => 
      collab.userId === userId ? collab.collaboratorId : collab.userId
    );
    
    return { user, connectedUserIds };
  };

  const { user, connectedUserIds } = await getUserFeedData(userId);

  const feedItems = [];
  
  // Get Posts
  if (type === 'all' || type === 'posts') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const posts = await scanItems(
      process.env.DYNAMODB_POSTS_TABLE || 'networkx-posts',
      'visibility = :visibility AND createdAt >= :thirtyDaysAgo',
      {
        ':visibility': 'public',
        ':thirtyDaysAgo': thirtyDaysAgo
      }
    );
    
    // Sort by creation date descending and limit
    const sortedPosts = posts
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, type === 'posts' ? limit * 2 : limit);
    
    // Get author details for posts
    for (const post of sortedPosts) {
      try {
        const author = await User.findById(post.userId)
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
          isFromConnection: connectedUserIds.includes(post.userId)
        });
      } catch (error) {
        console.error('Error fetching post author:', error);
      }
    }
  }
  
  // Get Projects
  if (type === 'all' || type === 'projects') {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const projects = await scanItems(
      process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects',
      'visibility = :visibility AND createdAt >= :sixtyDaysAgo',
      {
        ':visibility': 'public',
        ':sixtyDaysAgo': sixtyDaysAgo
      }
    );
    
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
    const events = await scanItems(
      process.env.DYNAMODB_EVENTS_TABLE || 'networkx-events',
      'visibility = :visibility AND startDate >= :now',
      {
        ':visibility': 'public',
        ':now': now
      }
    );
    
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
    const cacheKey = `trending:content:${limit}`;
    
    // Try cache first
    const cachedTrending = await getCache(cacheKey);
    if (cachedTrending) {
      return res.json(cachedTrending);
    }
    
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    
    // Get trending posts from DynamoDB
    const allPosts = await scanItems(process.env.DYNAMODB_POSTS_TABLE || 'networkx-posts', 
      'visibility = :visibility AND createdAt >= :sevenDaysAgo',
      {
        ':visibility': 'public',
        ':sevenDaysAgo': sevenDaysAgo
      }
    );
    
    // Sort posts by engagement (likes + comments * 2 + views * 0.1)
    const trendingPosts = allPosts
      .map(post => ({
        ...post,
        engagementScore: (post.likes || 0) + ((post.comments || 0) * 2) + ((post.views || 0) * 0.1)
      }))
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, Math.floor(limit * 0.6));
    
    // Get trending projects from DynamoDB
    const allProjects = await scanItems(process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects',
      'visibility = :visibility AND #status = :active AND createdAt >= :fourteenDaysAgo',
      {
        ':visibility': 'public',
        ':active': 'active',
        ':fourteenDaysAgo': fourteenDaysAgo
      },
      { '#status': 'status' }
    );
    
    // Sort projects by likes and member count
    const trendingProjects = allProjects
      .map(project => ({
        ...project,
        engagementScore: (project.likes || 0) + ((project.memberCount || 0) * 5) + ((project.views || 0) * 0.1)
      }))
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, Math.floor(limit * 0.4));
    
    // Get author details for posts
    const postsWithAuthors = await Promise.all(
      trendingPosts.map(async (post) => {
        const author = await User.findById(post.userId).select('firstName lastName username profileImage isVerified');
        return { ...post, author, contentType: 'post' };
      })
    );
    
    // Get owner details for projects
    const projectsWithOwners = await Promise.all(
      trendingProjects.map(async (project) => {
        const owner = await User.findById(project.ownerId).select('firstName lastName username profileImage');
        return { ...project, owner, contentType: 'project' };
      })
    );
    
    const trending = [...postsWithAuthors, ...projectsWithOwners]
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, limit);
    
    const result = {
      trending,
      lastUpdated: new Date().toISOString()
    };
    
    // Cache for 30 minutes
    await setCache(cacheKey, result, 1800);
    
    res.json(result);
    
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
    
    const user = await User.findById(req.user.id)
      .select('interests skills department year');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let recommendations = [];
    
    if (type === 'users') {
      // Recommend users with similar interests/skills
      const query = {
        _id: { $ne: req.user.id },
        isActive: true,
        $or: [
          { department: user.department },
          { year: user.year }
        ]
      };
      
      recommendations = await User.find(query)
        .select('firstName lastName username profileImage department year skills interests rating isVerified')
        .limit(parseInt(limit))
        .sort({ rating: -1 });
    } else if (type === 'projects') {
      // Recommend projects based on user skills
      const allProjects = await scanItems(process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects');
      
      const filtered = allProjects
        .filter(p => p.visibility === 'public' && p.status === 'recruiting' && p.ownerId !== String(req.user.id))
        .filter(p => {
          // Match at least one required skill
          if (!p.skillsRequired || p.skillsRequired.length === 0) return true;
          return (user.skills || []).some(skill => 
            p.skillsRequired.some(reqSkill => reqSkill.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(reqSkill.toLowerCase()))
          );
        })
        .slice(0, parseInt(limit));
      
      // Attach owner info
      recommendations = await Promise.all(filtered.map(async (proj) => {
        const owner = await User.findById(proj.ownerId).select('firstName lastName username profileImage');
        return { ...proj, owner };
      }));
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
