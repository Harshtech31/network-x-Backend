const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const User = require('../models/mongodb/User');
const { getItem, updateItem, deleteItem, scanItems, queryItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache } = require('../config/redis');
const RealtimeService = require('../services/realtime');

const router = express.Router();

// All admin routes require authentication and admin privileges
router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin/users - Get all users with pagination and filters
router.get('/users', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      role, 
      department, 
      isActive, 
      isVerified,
      search 
    } = req.query;

    const query = {};
    
    if (role) query.role = role;
    if (department) query.department = department;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (isVerified !== undefined) query.isVerified = isVerified === 'true';
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password -refreshToken -resetPasswordToken -verificationToken')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT /api/admin/users/:userId - Update user (role, status, etc.)
router.put('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, isActive, isVerified, reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = {};
    if (role) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;
    if (isVerified !== undefined) updates.isVerified = isVerified;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password -refreshToken -resetPasswordToken -verificationToken');

    // Log admin action
    console.log(`Admin ${req.user.username} updated user ${user.username}:`, updates, reason ? `Reason: ${reason}` : '');

    // Send notification to user if status changed
    if (isActive !== undefined || isVerified !== undefined) {
      await RealtimeService.sendNotification(userId, {
        type: 'account_update',
        title: 'Account Status Updated',
        message: `Your account status has been updated by an administrator.`,
        data: { updates, reason }
      });
    }

    res.json({
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/admin/users/:userId - Delete user account
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Soft delete - deactivate instead of hard delete
    await User.findByIdAndUpdate(userId, { 
      isActive: false, 
      deletedAt: new Date(),
      deletedBy: req.user.id,
      deleteReason: reason 
    });

    // Log admin action
    console.log(`Admin ${req.user.username} deleted user ${user.username}. Reason: ${reason}`);

    res.json({ message: 'User account deactivated successfully' });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /api/admin/reports - Get content reports
router.get('/reports', async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending', type } = req.query;
    const REPORTS_TABLE = process.env.DYNAMODB_REPORTS_TABLE || 'networkx-reports';

    let filterExpression = '#status = :status';
    let expressionAttributeNames = { '#status': 'status' };
    let expressionAttributeValues = { ':status': status };

    if (type) {
      filterExpression += ' AND #type = :type';
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = type;
    }

    const reports = await scanItems(
      REPORTS_TABLE,
      filterExpression,
      expressionAttributeValues,
      parseInt(limit),
      expressionAttributeNames
    );

    // Get reporter and reported user details
    const reportsWithUsers = await Promise.all(
      reports.map(async (report) => {
        const [reporter, reportedUser] = await Promise.all([
          User.findById(report.reporterId).select('firstName lastName username'),
          User.findById(report.reportedUserId).select('firstName lastName username')
        ]);
        return {
          ...report,
          reporter,
          reportedUser
        };
      })
    );

    res.json({
      reports: reportsWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: reportsWithUsers.length
      }
    });
  } catch (error) {
    console.error('Admin get reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// PUT /api/admin/reports/:reportId - Update report status
router.put('/reports/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, action, notes } = req.body;
    const REPORTS_TABLE = process.env.DYNAMODB_REPORTS_TABLE || 'networkx-reports';

    const report = await getItem(REPORTS_TABLE, { reportId });
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const updateExpression = 'SET #status = :status, reviewedBy = :reviewedBy, reviewedAt = :reviewedAt, adminNotes = :notes';
    const expressionAttributeNames = { '#status': 'status' };
    const expressionAttributeValues = {
      ':status': status,
      ':reviewedBy': req.user.id,
      ':reviewedAt': new Date().toISOString(),
      ':notes': notes || ''
    };

    if (action) {
      updateExpression += ', adminAction = :action';
      expressionAttributeValues[':action'] = action;
    }

    await updateItem(
      REPORTS_TABLE,
      { reportId },
      updateExpression,
      expressionAttributeValues,
      expressionAttributeNames
    );

    // Take action based on admin decision
    if (action === 'suspend_user' && report.reportedUserId) {
      await User.findByIdAndUpdate(report.reportedUserId, { isActive: false });
    } else if (action === 'delete_content' && report.contentId) {
      // Delete the reported content based on type
      const contentTable = getContentTable(report.contentType);
      if (contentTable) {
        await deleteItem(contentTable, { [getContentIdField(report.contentType)]: report.contentId });
      }
    }

    res.json({ message: 'Report updated successfully' });
  } catch (error) {
    console.error('Admin update report error:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// GET /api/admin/content/:type - Get content for moderation
router.get('/content/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 20, flagged = false } = req.query;

    const contentTable = getContentTable(type);
    if (!contentTable) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    let filterExpression = null;
    let expressionAttributeValues = {};

    if (flagged === 'true') {
      filterExpression = 'attribute_exists(flagged) AND flagged = :flagged';
      expressionAttributeValues = { ':flagged': true };
    }

    const content = await scanItems(
      contentTable,
      filterExpression,
      expressionAttributeValues,
      parseInt(limit)
    );

    // Get user details for each content item
    const contentWithUsers = await Promise.all(
      content.map(async (item) => {
        const user = await User.findById(item.userId).select('firstName lastName username');
        return {
          ...item,
          author: user
        };
      })
    );

    res.json({
      content: contentWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: contentWithUsers.length
      }
    });
  } catch (error) {
    console.error('Admin get content error:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// DELETE /api/admin/content/:type/:id - Delete content
router.delete('/content/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    const contentTable = getContentTable(type);
    const idField = getContentIdField(type);

    if (!contentTable || !idField) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    const content = await getItem(contentTable, { [idField]: id });
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    await deleteItem(contentTable, { [idField]: id });

    // Log admin action
    console.log(`Admin ${req.user.username} deleted ${type} ${id}. Reason: ${reason}`);

    // Notify content owner
    await RealtimeService.sendNotification(content.userId, {
      type: 'content_removed',
      title: 'Content Removed',
      message: `Your ${type} has been removed by a moderator.`,
      data: { contentType: type, reason }
    });

    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    console.error('Admin delete content error:', error);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// Helper functions
function getContentTable(type) {
  const tables = {
    'post': process.env.DYNAMODB_POSTS_TABLE || 'networkx-posts',
    'project': process.env.DYNAMODB_PROJECTS_TABLE || 'networkx-projects',
    'club': process.env.DYNAMODB_CLUBS_TABLE || 'networkx-clubs',
    'event': process.env.DYNAMODB_EVENTS_TABLE || 'networkx-events'
  };
  return tables[type];
}

function getContentIdField(type) {
  const fields = {
    'post': 'postId',
    'project': 'projectId',
    'club': 'clubId',
    'event': 'eventId'
  };
  return fields[type];
}

module.exports = router;
