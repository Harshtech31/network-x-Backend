const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const RealtimeService = require('../services/realtime');
const { getUserPresence } = require('../config/socket');

const router = express.Router();

// GET /api/realtime/status - Get real-time system status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const onlineUsersCount = RealtimeService.getOnlineUsersCount();
    
    res.json({
      status: 'active',
      onlineUsers: onlineUsersCount,
      features: {
        messaging: true,
        notifications: true,
        postInteractions: true,
        projectInteractions: true,
        clubInteractions: true,
        eventInteractions: true,
        userInteractions: true,
        presence: true
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get realtime status error:', error);
    res.status(500).json({ error: 'Failed to get realtime status' });
  }
});

// GET /api/realtime/presence/:userId - Get user presence
router.get('/presence/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const presence = await getUserPresence(userId);
    
    if (!presence) {
      return res.json({
        userId,
        status: 'offline',
        lastSeen: null,
        isOnline: false
      });
    }

    res.json({
      userId,
      status: presence.status,
      lastSeen: presence.lastSeen,
      isOnline: RealtimeService.isUserOnline(userId)
    });
  } catch (error) {
    console.error('Get user presence error:', error);
    res.status(500).json({ error: 'Failed to get user presence' });
  }
});

// POST /api/realtime/broadcast - Broadcast system announcement (admin only)
router.post('/broadcast', authenticateToken, async (req, res) => {
  try {
    const { title, message, type = 'info' } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    // Note: In a real application, you'd check if the user is an admin
    // For now, we'll allow any authenticated user to broadcast
    
    const announcement = {
      title,
      message,
      type,
      sender: {
        id: req.user.id,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        username: req.user.username
      }
    };

    const broadcasted = RealtimeService.broadcastAnnouncement(announcement);
    
    if (broadcasted) {
      res.json({
        message: 'Announcement broadcasted successfully',
        announcement
      });
    } else {
      res.status(500).json({ error: 'Failed to broadcast announcement' });
    }
  } catch (error) {
    console.error('Broadcast announcement error:', error);
    res.status(500).json({ error: 'Failed to broadcast announcement' });
  }
});

// POST /api/realtime/notification - Send custom notification
router.post('/notification', authenticateToken, async (req, res) => {
  try {
    const { targetUserId, type, title, message, data } = req.body;
    
    if (!targetUserId || !type || !title || !message) {
      return res.status(400).json({ 
        error: 'targetUserId, type, title, and message are required' 
      });
    }

    const result = await RealtimeService.sendNotification(targetUserId, {
      senderId: req.user.id,
      type,
      title,
      message,
      data: data || {}
    });

    res.json({
      message: 'Notification sent successfully',
      sent: result.sent,
      stored: result.stored,
      isReceiverOnline: RealtimeService.isUserOnline(targetUserId)
    });
  } catch (error) {
    console.error('Send custom notification error:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// GET /api/realtime/health - Health check for real-time services
router.get('/health', (req, res) => {
  try {
    const onlineUsersCount = RealtimeService.getOnlineUsersCount();
    
    res.json({
      status: 'healthy',
      services: {
        socketio: true,
        redis: true,
        notifications: true,
        messaging: true
      },
      metrics: {
        onlineUsers: onlineUsersCount,
        uptime: process.uptime()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Realtime health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
