const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS } = require('../config/redis');
const User = require('../models/mongodb/User');

const router = express.Router();
const REPORTS_TABLE = process.env.DYNAMODB_REPORTS_TABLE || 'networkx-reports';

// POST /api/reports/content - Report inappropriate content
router.post('/content', authenticateToken, [
  body('contentType').isIn(['post', 'project', 'club', 'event', 'message', 'user', 'comment']).withMessage('Invalid content type'),
  body('contentId').notEmpty().withMessage('Content ID is required'),
  body('reason').isIn(['spam', 'harassment', 'inappropriate', 'violence', 'hate_speech', 'misinformation', 'copyright', 'other']).withMessage('Invalid report reason'),
  body('description').optional().isLength({ max: 500 }).withMessage('Description must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { contentType, contentId, reason, description = '' } = req.body;
    const reporterId = req.user.id;
    const reportId = uuidv4();

    // Check if user has already reported this content
    const existingReports = await queryItems(
      REPORTS_TABLE,
      'contentId = :contentId AND reporterId = :reporterId',
      { 
        ':contentId': contentId,
        ':reporterId': reporterId
      }
    );

    if (existingReports.length > 0) {
      return res.status(400).json({ error: 'You have already reported this content' });
    }

    const report = {
      reportId,
      contentType,
      contentId,
      reporterId,
      reason,
      description,
      status: 'pending', // pending, reviewed, resolved, dismissed
      priority: reason === 'violence' || reason === 'hate_speech' ? 'high' : 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(REPORTS_TABLE, report);

    // Get reporter details
    const reporter = await User.findById(reporterId).select('firstName lastName username');

    res.status(201).json({
      message: 'Content reported successfully',
      report: {
        ...report,
        reporter
      }
    });
  } catch (error) {
    console.error('Report content error:', error);
    res.status(500).json({ error: 'Failed to report content' });
  }
});

// GET /api/reports - Get reports (admin only)
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin (you'll need to add isAdmin field to User model)
    const user = await User.findById(req.user.id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    const { status, contentType, priority, page = 1, limit = 20 } = req.query;
    const cacheKey = `reports:${status || 'all'}:${contentType || 'all'}:${priority || 'all'}:${page}`;
    
    // Try cache first
    const cachedReports = await getCache(cacheKey);
    if (cachedReports) {
      return res.json(cachedReports);
    }

    // Get all reports
    let reports = await scanItems(REPORTS_TABLE);

    // Apply filters
    if (status) {
      reports = reports.filter(report => report.status === status);
    }
    if (contentType) {
      reports = reports.filter(report => report.contentType === contentType);
    }
    if (priority) {
      reports = reports.filter(report => report.priority === priority);
    }

    // Sort by priority and creation date
    reports.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Pagination
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const paginatedReports = reports.slice(startIndex, startIndex + parseInt(limit));

    // Get reporter details for each report
    const reportsWithDetails = await Promise.all(
      paginatedReports.map(async (report) => {
        const reporter = await User.findById(report.reporterId).select('firstName lastName username');
        return {
          ...report,
          reporter
        };
      })
    );

    const result = {
      reports: reportsWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: reports.length,
        pages: Math.ceil(reports.length / parseInt(limit))
      },
      stats: {
        pending: reports.filter(r => r.status === 'pending').length,
        reviewed: reports.filter(r => r.status === 'reviewed').length,
        resolved: reports.filter(r => r.status === 'resolved').length,
        dismissed: reports.filter(r => r.status === 'dismissed').length
      }
    };

    // Cache for 5 minutes
    await setCache(cacheKey, result, 300);
    
    res.json(result);
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// PUT /api/reports/:id/moderate - Moderate a report (admin only)
router.put('/:id/moderate', authenticateToken, [
  body('action').isIn(['dismiss', 'resolve', 'escalate']).withMessage('Invalid moderation action'),
  body('moderatorNotes').optional().isLength({ max: 1000 }).withMessage('Moderator notes must be less than 1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    // Check if user is admin
    const user = await User.findById(req.user.id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    const { id } = req.params;
    const { action, moderatorNotes = '' } = req.body;
    const moderatorId = req.user.id;

    // Get the report
    const reports = await queryItems(
      REPORTS_TABLE,
      'reportId = :reportId',
      { ':reportId': id }
    );

    if (reports.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const report = reports[0];

    // Update report status based on action
    let newStatus;
    switch (action) {
      case 'dismiss':
        newStatus = 'dismissed';
        break;
      case 'resolve':
        newStatus = 'resolved';
        break;
      case 'escalate':
        newStatus = 'reviewed';
        break;
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const updateExpression = 'SET #status = :status, moderatorId = :moderatorId, moderatorNotes = :moderatorNotes, moderatedAt = :moderatedAt, updatedAt = :updatedAt';
    const expressionAttributeNames = {
      '#status': 'status'
    };
    const expressionAttributeValues = {
      ':status': newStatus,
      ':moderatorId': moderatorId,
      ':moderatorNotes': moderatorNotes,
      ':moderatedAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString()
    };

    await updateItem(
      REPORTS_TABLE,
      { reportId: id },
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );

    // Clear cache
    await deleteCache(`reports:*`);

    res.json({
      message: `Report ${action}ed successfully`,
      reportId: id,
      newStatus,
      moderatedBy: moderatorId,
      moderatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Moderate report error:', error);
    res.status(500).json({ error: 'Failed to moderate report' });
  }
});

// GET /api/reports/stats - Get reporting statistics (admin only)
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    const user = await User.findById(req.user.id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
    }

    const cacheKey = 'reports:stats';
    
    // Try cache first
    const cachedStats = await getCache(cacheKey);
    if (cachedStats) {
      return res.json(cachedStats);
    }

    // Get all reports
    const reports = await scanItems(REPORTS_TABLE);

    const stats = {
      total: reports.length,
      byStatus: {
        pending: reports.filter(r => r.status === 'pending').length,
        reviewed: reports.filter(r => r.status === 'reviewed').length,
        resolved: reports.filter(r => r.status === 'resolved').length,
        dismissed: reports.filter(r => r.status === 'dismissed').length
      },
      byContentType: {
        post: reports.filter(r => r.contentType === 'post').length,
        project: reports.filter(r => r.contentType === 'project').length,
        club: reports.filter(r => r.contentType === 'club').length,
        event: reports.filter(r => r.contentType === 'event').length,
        message: reports.filter(r => r.contentType === 'message').length,
        user: reports.filter(r => r.contentType === 'user').length,
        comment: reports.filter(r => r.contentType === 'comment').length
      },
      byReason: {
        spam: reports.filter(r => r.reason === 'spam').length,
        harassment: reports.filter(r => r.reason === 'harassment').length,
        inappropriate: reports.filter(r => r.reason === 'inappropriate').length,
        violence: reports.filter(r => r.reason === 'violence').length,
        hate_speech: reports.filter(r => r.reason === 'hate_speech').length,
        misinformation: reports.filter(r => r.reason === 'misinformation').length,
        copyright: reports.filter(r => r.reason === 'copyright').length,
        other: reports.filter(r => r.reason === 'other').length
      },
      byPriority: {
        high: reports.filter(r => r.priority === 'high').length,
        medium: reports.filter(r => r.priority === 'medium').length,
        low: reports.filter(r => r.priority === 'low').length
      }
    };

    // Cache for 10 minutes
    await setCache(cacheKey, stats, 600);
    
    res.json(stats);
  } catch (error) {
    console.error('Get report stats error:', error);
    res.status(500).json({ error: 'Failed to get report statistics' });
  }
});

module.exports = router;
