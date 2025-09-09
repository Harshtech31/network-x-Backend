const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const pushNotificationService = require('../services/pushNotificationService');
const { checkSNSConfiguration } = require('../config/sns');
const User = require('../models/mongodb/User');

const router = express.Router();

// Push notification validation middleware
const pushValidation = [
  body('deviceToken')
    .isLength({ min: 1 })
    .withMessage('Device token is required'),
  body('platform')
    .isIn(['ios', 'android'])
    .withMessage('Platform must be ios or android')
];

// POST /api/push/register - Register device for push notifications
router.post('/register', authenticateToken, pushValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { deviceToken, platform, deviceInfo = {} } = req.body;
    const userId = req.user.id;

    const result = await pushNotificationService.registerDevice(
      userId,
      deviceToken,
      platform,
      deviceInfo
    );

    res.json(result);

  } catch (error) {
    console.error('Push registration error:', error);
    res.status(500).json({
      error: 'Failed to register device',
      message: error.message
    });
  }
});

// POST /api/push/unregister - Unregister device from push notifications
router.post('/unregister', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId).select('pushNotifications');
    if (!user?.pushNotifications?.endpointArn) {
      return res.status(400).json({
        error: 'No registered device found'
      });
    }

    const result = await pushNotificationService.unregisterDevice(
      userId,
      user.pushNotifications.endpointArn
    );

    res.json(result);

  } catch (error) {
    console.error('Push unregistration error:', error);
    res.status(500).json({
      error: 'Failed to unregister device',
      message: error.message
    });
  }
});

// POST /api/push/send - Send push notification to specific user (admin only)
router.post('/send', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, title, body, data = {} } = req.body;

    if (!userId || !title || !body) {
      return res.status(400).json({
        error: 'User ID, title, and body are required'
      });
    }

    const notification = { title, body, data };
    const result = await pushNotificationService.sendToUser(userId, notification);

    res.json(result);

  } catch (error) {
    console.error('Send push notification error:', error);
    res.status(500).json({
      error: 'Failed to send push notification',
      message: error.message
    });
  }
});

// POST /api/push/send-bulk - Send push notification to multiple users (admin only)
router.post('/send-bulk', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userIds, title, body, data = {} } = req.body;

    if (!userIds || !Array.isArray(userIds) || !title || !body) {
      return res.status(400).json({
        error: 'User IDs array, title, and body are required'
      });
    }

    const notification = { title, body, data };
    const results = await pushNotificationService.sendToUsers(userIds, notification);

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      success: true,
      sent: successful,
      failed,
      total: results.length,
      results
    });

  } catch (error) {
    console.error('Bulk push notification error:', error);
    res.status(500).json({
      error: 'Failed to send bulk push notifications',
      message: error.message
    });
  }
});

// POST /api/push/broadcast - Send broadcast notification to all users (admin only)
router.post('/broadcast', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, body, data = {} } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        error: 'Title and body are required'
      });
    }

    const notification = { title, body, data };
    const result = await pushNotificationService.sendBroadcast(notification);

    res.json(result);

  } catch (error) {
    console.error('Broadcast notification error:', error);
    res.status(500).json({
      error: 'Failed to send broadcast notification',
      message: error.message
    });
  }
});

// POST /api/push/test - Send test notification to current user
router.post('/test', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title = 'Test Notification', body = 'This is a test push notification from Network-X!' } = req.body;

    const notification = {
      title,
      body,
      data: {
        type: 'test',
        timestamp: new Date().toISOString()
      }
    };

    const result = await pushNotificationService.sendToUser(userId, notification);

    res.json(result);

  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({
      error: 'Failed to send test notification',
      message: error.message
    });
  }
});

// GET /api/push/status - Get user's push notification status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const status = await pushNotificationService.getNotificationStatus(userId);

    res.json(status);

  } catch (error) {
    console.error('Push status error:', error);
    res.status(500).json({
      error: 'Failed to get push notification status',
      message: error.message
    });
  }
});

// PUT /api/push/preferences - Update push notification preferences
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      messages = true, 
      followers = true, 
      projects = true, 
      events = true, 
      posts = true, 
      comments = true 
    } = req.body;

    const preferences = {
      messages,
      followers,
      projects,
      events,
      posts,
      comments
    };

    const result = await pushNotificationService.updateNotificationPreferences(
      userId,
      preferences
    );

    res.json(result);

  } catch (error) {
    console.error('Update push preferences error:', error);
    res.status(500).json({
      error: 'Failed to update push notification preferences',
      message: error.message
    });
  }
});

// GET /api/push/preferences - Get push notification preferences
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const status = await pushNotificationService.getNotificationStatus(userId);

    res.json({
      preferences: status.preferences
    });

  } catch (error) {
    console.error('Get push preferences error:', error);
    res.status(500).json({
      error: 'Failed to get push notification preferences',
      message: error.message
    });
  }
});

// GET /api/push/config - Check SNS configuration status (admin only)
router.get('/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const isConfigured = await checkSNSConfiguration();

    res.json({
      configured: isConfigured,
      platformApplicationArn: process.env.SNS_PLATFORM_APPLICATION_ARN ? 'configured' : 'missing',
      topicArn: process.env.SNS_TOPIC_ARN ? 'configured' : 'missing'
    });

  } catch (error) {
    console.error('Push config error:', error);
    res.status(500).json({
      error: 'Failed to check push notification configuration',
      message: error.message
    });
  }
});

// POST /api/push/notify/message - Send new message notification
router.post('/notify/message', authenticateToken, async (req, res) => {
  try {
    const { recipientId, messageData } = req.body;
    const senderId = req.user.id;

    if (!recipientId || !messageData) {
      return res.status(400).json({
        error: 'Recipient ID and message data are required'
      });
    }

    const sender = await User.findById(senderId).select('firstName lastName username');
    const result = await pushNotificationService.sendNewMessageNotification(
      recipientId,
      sender,
      messageData
    );

    res.json(result);

  } catch (error) {
    console.error('Message notification error:', error);
    res.status(500).json({
      error: 'Failed to send message notification',
      message: error.message
    });
  }
});

// POST /api/push/notify/follower - Send new follower notification
router.post('/notify/follower', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.body;
    const followerId = req.user.id;

    if (!userId) {
      return res.status(400).json({
        error: 'User ID is required'
      });
    }

    const follower = await User.findById(followerId).select('firstName lastName username');
    const result = await pushNotificationService.sendNewFollowerNotification(userId, follower);

    res.json(result);

  } catch (error) {
    console.error('Follower notification error:', error);
    res.status(500).json({
      error: 'Failed to send follower notification',
      message: error.message
    });
  }
});

// POST /api/push/notify/project-invitation - Send project invitation notification
router.post('/notify/project-invitation', authenticateToken, async (req, res) => {
  try {
    const { invitedUserId, project } = req.body;
    const inviterId = req.user.id;

    if (!invitedUserId || !project) {
      return res.status(400).json({
        error: 'Invited user ID and project data are required'
      });
    }

    const inviter = await User.findById(inviterId).select('firstName lastName username');
    const result = await pushNotificationService.sendProjectInvitationNotification(
      invitedUserId,
      inviter,
      project
    );

    res.json(result);

  } catch (error) {
    console.error('Project invitation notification error:', error);
    res.status(500).json({
      error: 'Failed to send project invitation notification',
      message: error.message
    });
  }
});

// POST /api/push/notify/event-reminder - Send event reminder notification
router.post('/notify/event-reminder', authenticateToken, async (req, res) => {
  try {
    const { userId, event, timeUntil } = req.body;

    if (!userId || !event || !timeUntil) {
      return res.status(400).json({
        error: 'User ID, event data, and time until are required'
      });
    }

    const result = await pushNotificationService.sendEventReminderNotification(
      userId,
      event,
      timeUntil
    );

    res.json(result);

  } catch (error) {
    console.error('Event reminder notification error:', error);
    res.status(500).json({
      error: 'Failed to send event reminder notification',
      message: error.message
    });
  }
});

// POST /api/push/notify/post-like - Send post like notification
router.post('/notify/post-like', authenticateToken, async (req, res) => {
  try {
    const { postOwnerId, post } = req.body;
    const likerId = req.user.id;

    if (!postOwnerId || !post) {
      return res.status(400).json({
        error: 'Post owner ID and post data are required'
      });
    }

    const liker = await User.findById(likerId).select('firstName lastName username');
    const result = await pushNotificationService.sendPostLikeNotification(
      postOwnerId,
      liker,
      post
    );

    res.json(result);

  } catch (error) {
    console.error('Post like notification error:', error);
    res.status(500).json({
      error: 'Failed to send post like notification',
      message: error.message
    });
  }
});

module.exports = router;
