const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const User = require('../models/mongodb/User');
const { scanItems, queryItems } = require('../config/dynamodb');
const { getCache, setCache } = require('../config/redis');
const moment = require('moment');

const router = express.Router();

// All analytics routes require authentication
router.use(authenticateToken);

// GET /api/analytics/dashboard - Main dashboard stats (admin only)
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const cacheKey = 'analytics:dashboard';
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [
      totalUsers,
      activeUsers,
      verifiedUsers,
      totalPosts,
      totalProjects,
      totalClubs,
      totalEvents,
      recentUsers,
      topUsers
    ] = await Promise.all([
      // User statistics
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isVerified: true }),
      
      // Content statistics
      getContentCount('networkx-posts'),
      getContentCount('networkx-projects'),
      getContentCount('networkx-clubs'),
      getContentCount('networkx-events'),
      
      // Recent activity
      User.countDocuments({ 
        createdAt: { $gte: moment().subtract(7, 'days').toDate() } 
      }),
      
      // Top users by rating
      User.find({ isActive: true })
        .select('firstName lastName username rating totalRatings')
        .sort({ rating: -1, totalRatings: -1 })
        .limit(10)
    ]);

    const stats = {
      users: {
        total: totalUsers,
        active: activeUsers,
        verified: verifiedUsers,
        recentSignups: recentUsers,
        activePercentage: totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0
      },
      content: {
        posts: totalPosts,
        projects: totalProjects,
        clubs: totalClubs,
        events: totalEvents,
        total: totalPosts + totalProjects + totalClubs + totalEvents
      },
      topUsers,
      lastUpdated: new Date().toISOString()
    };

    // Cache for 10 minutes
    await setCache(cacheKey, stats, 600);
    res.json(stats);
  } catch (error) {
    console.error('Analytics dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard analytics' });
  }
});

// GET /api/analytics/users - User analytics (admin only)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const cacheKey = `analytics:users:${period}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const days = parseInt(period.replace('d', ''));
    const startDate = moment().subtract(days, 'days').toDate();

    const [
      signupTrend,
      departmentStats,
      yearStats,
      activityStats
    ] = await Promise.all([
      // Daily signup trend
      User.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      
      // Department distribution
      User.aggregate([
        { $match: { isActive: true, department: { $ne: '' } } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Year distribution
      User.aggregate([
        { $match: { isActive: true, year: { $ne: null } } },
        { $group: { _id: '$year', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      
      // Activity stats
      User.aggregate([
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            totalRatings: { $sum: '$totalRatings' },
            activeToday: {
              $sum: {
                $cond: [
                  { $gte: ['$lastSeen', moment().startOf('day').toDate()] },
                  1,
                  0
                ]
              }
            },
            activeThisWeek: {
              $sum: {
                $cond: [
                  { $gte: ['$lastSeen', moment().subtract(7, 'days').toDate()] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ])
    ]);

    const analytics = {
      signupTrend,
      departmentStats,
      yearStats,
      activityStats: activityStats[0] || {},
      period,
      generatedAt: new Date().toISOString()
    };

    // Cache for 30 minutes
    await setCache(cacheKey, analytics, 1800);
    res.json(analytics);
  } catch (error) {
    console.error('User analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch user analytics' });
  }
});

// GET /api/analytics/content - Content analytics (admin only)
router.get('/content', requireAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const cacheKey = `analytics:content:${period}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const days = parseInt(period.replace('d', ''));
    const startDate = moment().subtract(days, 'days').toISOString();

    const [postsStats, projectsStats, clubsStats, eventsStats] = await Promise.all([
      getContentAnalytics('networkx-posts', startDate),
      getContentAnalytics('networkx-projects', startDate),
      getContentAnalytics('networkx-clubs', startDate),
      getContentAnalytics('networkx-events', startDate)
    ]);

    const analytics = {
      posts: postsStats,
      projects: projectsStats,
      clubs: clubsStats,
      events: eventsStats,
      period,
      generatedAt: new Date().toISOString()
    };

    // Cache for 30 minutes
    await setCache(cacheKey, analytics, 1800);
    res.json(analytics);
  } catch (error) {
    console.error('Content analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch content analytics' });
  }
});

// GET /api/analytics/engagement - Engagement analytics (admin only)
router.get('/engagement', requireAdmin, async (req, res) => {
  try {
    const cacheKey = 'analytics:engagement';
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const POSTS_TABLE = process.env.DYNAMODB_POSTS_TABLE || 'networkx-posts';
    const posts = await scanItems(POSTS_TABLE);

    const engagement = {
      totalLikes: posts.reduce((sum, post) => sum + (post.likes || 0), 0),
      totalComments: posts.reduce((sum, post) => sum + (post.comments || 0), 0),
      totalShares: posts.reduce((sum, post) => sum + (post.shares || 0), 0),
      avgLikesPerPost: posts.length > 0 ? (posts.reduce((sum, post) => sum + (post.likes || 0), 0) / posts.length).toFixed(2) : 0,
      avgCommentsPerPost: posts.length > 0 ? (posts.reduce((sum, post) => sum + (post.comments || 0), 0) / posts.length).toFixed(2) : 0,
      mostLikedPosts: posts
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 10)
        .map(post => ({
          postId: post.postId,
          content: post.content?.substring(0, 100) + '...',
          likes: post.likes || 0,
          comments: post.comments || 0,
          createdAt: post.createdAt
        })),
      generatedAt: new Date().toISOString()
    };

    // Cache for 15 minutes
    await setCache(cacheKey, engagement, 900);
    res.json(engagement);
  } catch (error) {
    console.error('Engagement analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch engagement analytics' });
  }
});

// GET /api/analytics/my-stats - Personal user stats
router.get('/my-stats', async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `analytics:user:${userId}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const [user, userPosts, userProjects, userClubs] = await Promise.all([
      User.findById(userId).select('createdAt followers following rating totalRatings'),
      getUserContent('networkx-posts', userId),
      getUserContent('networkx-projects', userId),
      getUserContent('networkx-clubs', userId)
    ]);

    const stats = {
      profile: {
        memberSince: user.createdAt,
        followersCount: user.followers?.length || 0,
        followingCount: user.following?.length || 0,
        rating: user.rating || 0,
        totalRatings: user.totalRatings || 0
      },
      content: {
        posts: userPosts.length,
        projects: userProjects.length,
        clubs: userClubs.length,
        totalLikes: userPosts.reduce((sum, post) => sum + (post.likes || 0), 0),
        totalComments: userPosts.reduce((sum, post) => sum + (post.comments || 0), 0)
      },
      recentActivity: {
        recentPosts: userPosts.slice(0, 5),
        recentProjects: userProjects.slice(0, 5)
      },
      generatedAt: new Date().toISOString()
    };

    // Cache for 5 minutes
    await setCache(cacheKey, stats, 300);
    res.json(stats);
  } catch (error) {
    console.error('Personal stats error:', error);
    res.status(500).json({ error: 'Failed to fetch personal statistics' });
  }
});

// Helper functions
async function getContentCount(tableName) {
  try {
    const items = await scanItems(tableName);
    return items.length;
  } catch (error) {
    console.error(`Error counting items in ${tableName}:`, error);
    return 0;
  }
}

async function getContentAnalytics(tableName, startDate) {
  try {
    const items = await scanItems(tableName);
    const recentItems = items.filter(item => item.createdAt >= startDate);
    
    return {
      total: items.length,
      recent: recentItems.length,
      avgPerDay: recentItems.length / 30,
      trend: recentItems.map(item => ({
        date: moment(item.createdAt).format('YYYY-MM-DD'),
        count: 1
      })).reduce((acc, curr) => {
        const existing = acc.find(item => item.date === curr.date);
        if (existing) {
          existing.count++;
        } else {
          acc.push(curr);
        }
        return acc;
      }, []).sort((a, b) => a.date.localeCompare(b.date))
    };
  } catch (error) {
    console.error(`Error analyzing ${tableName}:`, error);
    return { total: 0, recent: 0, avgPerDay: 0, trend: [] };
  }
}

async function getUserContent(tableName, userId) {
  try {
    const items = await queryItems(
      tableName,
      'userId = :userId',
      { ':userId': userId },
      'UserPostsIndex' // Assuming this index exists
    );
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error(`Error fetching user content from ${tableName}:`, error);
    return [];
  }
}

module.exports = router;
