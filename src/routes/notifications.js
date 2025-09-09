const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { putItem, getItem, updateItem, deleteItem, queryItems, scanItems } = require('../config/dynamodb');
const { setCache, getCache, deleteCache, CACHE_KEYS } = require('../config/redis');
const User = require('../models/mongodb/User');

const router = express.Router();
const NOTIFICATIONS_TABLE = process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'networkx-notifications';

// GET /api/notifications - Get user notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, type, unread } = req.query;
    const userId = req.user.id;
    const cacheKey = CACHE_KEYS.NOTIFICATIONS(userId, page);
    
    // Try cache first
    const cachedNotifications = await getCache(cacheKey);
    if (cachedNotifications) {
      return res.json(cachedNotifications);
    }

    // Get notifications for this user
    let notifications = await queryItems(
      NOTIFICATIONS_TABLE,
      'userId = :userId',
      { ':userId': userId },
      null,
      parseInt(limit)
    );

    // Apply filters
    if (type) {
      notifications = notifications.filter(notification => notification.type === type);
    }
    if (unread === 'true') {
      notifications = notifications.filter(notification => !notification.isRead);
    }

    // Get sender details for each notification
    const notificationsWithSenders = await Promise.all(
      notifications.map(async (notification) => {
        let sender = null;
        if (notification.senderId) {
          sender = await User.findById(notification.senderId).select('firstName lastName username profileImage');
        }
        return {
          ...notification,
          sender
        };
      })
    );

    // Sort by timestamp (newest first)
    notificationsWithSenders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const result = {
      notifications: notificationsWithSenders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: notificationsWithSenders.length
      },
      unreadCount: notificationsWithSenders.filter(n => !n.isRead).length
    };

    // Cache for 2 minutes
    await setCache(cacheKey, result, 120);
    
    res.json(result);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// POST /api/notifications - Create a new notification (internal use)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { 
      userId: targetUserId, 
      type, 
      title, 
      message, 
      data = {}, 
      senderId 
    } = req.body;
    
    if (!targetUserId || !type || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields: userId, type, title, message' });
    }

    const notificationId = uuidv4();
    
    const notification = {
      notificationId,
      userId: targetUserId,
      senderId: senderId || req.user.id,
      type, // 'like', 'comment', 'follow', 'project_invite', 'club_invite', 'event_reminder', etc.
      title,
      message,
      data, // Additional context data
      isRead: false,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(NOTIFICATIONS_TABLE, notification);

    // Get sender details if available
    let sender = null;
    if (notification.senderId) {
      sender = await User.findById(notification.senderId).select('firstName lastName username profileImage');
    }
    
    const responseNotification = {
      ...notification,
      sender
    };

    // Invalidate cache
    await deleteCache(CACHE_KEYS.NOTIFICATIONS(targetUserId, 1));

    res.status(201).json({
      message: 'Notification created successfully',
      notification: responseNotification
    });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Get the notification first
    const notification = await getItem(NOTIFICATIONS_TABLE, { userId, notificationId: id });
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.isRead) {
      return res.status(400).json({ error: 'Notification already marked as read' });
    }

    const updateExpression = 'SET isRead = :isRead, readAt = :readAt, updatedAt = :updatedAt';
    const expressionAttributeValues = {
      ':isRead': true,
      ':readAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString()
    };

    await updateItem(
      NOTIFICATIONS_TABLE,
      { userId, notificationId: id },
      updateExpression,
      expressionAttributeValues
    );

    // Invalidate cache
    await deleteCache(CACHE_KEYS.NOTIFICATIONS(userId, 1));

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all unread notifications for this user
    const notifications = await queryItems(
      NOTIFICATIONS_TABLE,
      'userId = :userId',
      { ':userId': userId }
    );

    const unreadNotifications = notifications.filter(n => !n.isRead);
    
    if (unreadNotifications.length === 0) {
      return res.json({ message: 'No unread notifications to mark as read' });
    }

    // Update each unread notification
    const updatePromises = unreadNotifications.map(notification => {
      const updateExpression = 'SET isRead = :isRead, readAt = :readAt, updatedAt = :updatedAt';
      const expressionAttributeValues = {
        ':isRead': true,
        ':readAt': new Date().toISOString(),
        ':updatedAt': new Date().toISOString()
      };

      return updateItem(
        NOTIFICATIONS_TABLE,
        { userId, notificationId: notification.notificationId },
        updateExpression,
        expressionAttributeValues
      );
    });

    await Promise.all(updatePromises);

    // Invalidate cache
    await deleteCache(CACHE_KEYS.NOTIFICATIONS(userId, 1));

    res.json({ 
      message: `Marked ${unreadNotifications.length} notifications as read`,
      count: unreadNotifications.length
    });
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Check if notification exists and belongs to user
    const notification = await getItem(NOTIFICATIONS_TABLE, { userId, notificationId: id });
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await deleteItem(NOTIFICATIONS_TABLE, { userId, notificationId: id });

    // Invalidate cache
    await deleteCache(CACHE_KEYS.NOTIFICATIONS(userId, 1));

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// DELETE /api/notifications/clear-all - Clear all notifications
router.delete('/clear-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all notifications for this user
    const notifications = await queryItems(
      NOTIFICATIONS_TABLE,
      'userId = :userId',
      { ':userId': userId }
    );
    
    if (notifications.length === 0) {
      return res.json({ message: 'No notifications to clear' });
    }

    // Delete each notification
    const deletePromises = notifications.map(notification => 
      deleteItem(NOTIFICATIONS_TABLE, { userId, notificationId: notification.notificationId })
    );

    await Promise.all(deletePromises);

    // Invalidate cache
    await deleteCache(CACHE_KEYS.NOTIFICATIONS(userId, 1));

    res.json({ 
      message: `Cleared ${notifications.length} notifications`,
      count: notifications.length
    });
  } catch (error) {
    console.error('Clear all notifications error:', error);
    res.status(500).json({ error: 'Failed to clear all notifications' });
  }
});

// GET /api/notifications/unread-count - Get unread notification count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `notifications:unread:${userId}`;
    
    // Try cache first
    const cachedCount = await getCache(cacheKey);
    if (cachedCount !== null) {
      return res.json({ unreadCount: cachedCount });
    }

    // Get all notifications for this user
    const notifications = await queryItems(
      NOTIFICATIONS_TABLE,
      'userId = :userId',
      { ':userId': userId }
    );

    const unreadCount = notifications.filter(n => !n.isRead).length;

    // Cache for 1 minute
    await setCache(cacheKey, unreadCount, 60);
    
    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Helper function to create notifications (can be used by other routes)
const createNotification = async ({
  userId,
  senderId = null,
  type,
  title,
  message,
  data = {}
}) => {
  try {
    const notificationId = uuidv4();
    
    const notification = {
      notificationId,
      userId,
      senderId,
      type,
      title,
      message,
      data,
      isRead: false,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await putItem(NOTIFICATIONS_TABLE, notification);

    // Invalidate cache
    await deleteCache(CACHE_KEYS.NOTIFICATIONS(userId, 1));
    await deleteCache(`notifications:unread:${userId}`);

    return notification;
  } catch (error) {
    console.error('Create notification helper error:', error);
    throw error;
  }
};

// POST /api/notifications/register-token - Register push notification token
router.post('/register-token', authenticateToken, [
  body('token').notEmpty().withMessage('Push token is required'),
  body('platform').isIn(['ios', 'android', 'web']).withMessage('Platform must be ios, android, or web')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { token, platform } = req.body;
    const userId = req.user.id;

    // Update user's push token in MongoDB
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.pushTokens = user.pushTokens || [];
    
    // Remove existing token for this platform
    user.pushTokens = user.pushTokens.filter(t => t.platform !== platform);
    
    // Add new token
    user.pushTokens.push({
      token,
      platform,
      registeredAt: new Date()
    });

    await user.save();

    res.json({
      message: 'Push token registered successfully',
      platform,
      registeredAt: new Date()
    });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ error: 'Failed to register push token' });
  }
});

// PUT /api/notifications/settings - Update notification preferences
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      pushEnabled = true,
      emailEnabled = true,
      messageNotifications = true,
      postNotifications = true,
      projectNotifications = true,
      clubNotifications = true,
      eventNotifications = true,
      followNotifications = true
    } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.notificationSettings = {
      pushEnabled,
      emailEnabled,
      messageNotifications,
      postNotifications,
      projectNotifications,
      clubNotifications,
      eventNotifications,
      followNotifications,
      updatedAt: new Date()
    };

    await user.save();

    res.json({
      message: 'Notification settings updated successfully',
      settings: user.notificationSettings
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

// GET /api/notifications/settings - Get notification preferences
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('notificationSettings');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const defaultSettings = {
      pushEnabled: true,
      emailEnabled: true,
      messageNotifications: true,
      postNotifications: true,
      projectNotifications: true,
      clubNotifications: true,
      eventNotifications: true,
      followNotifications: true
    };

    res.json({
      settings: user.notificationSettings || defaultSettings
    });
  } catch (error) {
    console.error('Get notification settings error:', error);
    res.status(500).json({ error: 'Failed to get notification settings' });
  }
});

module.exports = { router, createNotification };
module.exports.router = router;
module.exports.createNotification = createNotification;
