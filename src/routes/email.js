const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const emailService = require('../services/emailService');
const { checkSESConfiguration, getSendingStatistics } = require('../config/ses');
const User = require('../models/mongodb/User');

const router = express.Router();

// Email validation middleware
const emailValidation = [
  body('to')
    .isEmail()
    .withMessage('Valid email address is required'),
  body('subject')
    .isLength({ min: 1, max: 200 })
    .withMessage('Subject must be between 1 and 200 characters'),
  body('content')
    .isLength({ min: 1 })
    .withMessage('Email content is required')
];

// POST /api/email/send - Send individual email (admin only)
router.post('/send', authenticateToken, requireAdmin, emailValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { to, subject, content, isHtml = true } = req.body;

    const emailData = {
      to,
      subject,
      htmlBody: isHtml ? content : `<pre>${content}</pre>`,
      textBody: isHtml ? content.replace(/<[^>]*>/g, '') : content
    };

    const result = await emailService.sendEmail(emailData);

    res.json({
      success: true,
      messageId: result.MessageId,
      message: 'Email sent successfully'
    });

  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({
      error: 'Failed to send email',
      message: error.message
    });
  }
});

// POST /api/email/welcome - Send welcome email to user
router.post('/welcome/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await emailService.sendWelcomeEmail(user);

    res.json({
      success: true,
      messageId: result.MessageId,
      message: 'Welcome email sent successfully'
    });

  } catch (error) {
    console.error('Welcome email error:', error);
    res.status(500).json({
      error: 'Failed to send welcome email',
      message: error.message
    });
  }
});

// POST /api/email/password-reset - Send password reset email
router.post('/password-reset', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({
        success: true,
        message: 'If the email exists, a password reset link has been sent'
      });
    }

    // Generate reset token (you should implement proper token generation)
    const resetToken = require('crypto').randomBytes(32).toString('hex');
    
    // Store reset token in user record with expiration
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    const result = await emailService.sendPasswordResetEmail(user, resetToken);

    res.json({
      success: true,
      messageId: result.MessageId,
      message: 'If the email exists, a password reset link has been sent'
    });

  } catch (error) {
    console.error('Password reset email error:', error);
    res.status(500).json({
      error: 'Failed to send password reset email',
      message: error.message
    });
  }
});

// POST /api/email/project-invitation - Send project invitation email
router.post('/project-invitation', authenticateToken, async (req, res) => {
  try {
    const { invitedUserId, projectId } = req.body;

    if (!invitedUserId || !projectId) {
      return res.status(400).json({ 
        error: 'Invited user ID and project ID are required' 
      });
    }

    const invitedUser = await User.findById(invitedUserId);
    if (!invitedUser) {
      return res.status(404).json({ error: 'Invited user not found' });
    }

    const inviterUser = await User.findById(req.user.id);
    
    // Get project details from DynamoDB (you would implement this)
    const project = {
      projectId,
      title: 'Sample Project', // Replace with actual project data
      description: 'Sample project description',
      skills: ['JavaScript', 'React'],
      inviteToken: require('crypto').randomBytes(32).toString('hex')
    };

    const result = await emailService.sendProjectInvitationEmail(
      invitedUser, 
      inviterUser, 
      project
    );

    res.json({
      success: true,
      messageId: result.MessageId,
      message: 'Project invitation sent successfully'
    });

  } catch (error) {
    console.error('Project invitation email error:', error);
    res.status(500).json({
      error: 'Failed to send project invitation',
      message: error.message
    });
  }
});

// POST /api/email/event-reminder - Send event reminder email
router.post('/event-reminder', authenticateToken, async (req, res) => {
  try {
    const { userId, eventId } = req.body;

    if (!userId || !eventId) {
      return res.status(400).json({ 
        error: 'User ID and event ID are required' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get event details from DynamoDB (you would implement this)
    const event = {
      eventId,
      title: 'Sample Event', // Replace with actual event data
      description: 'Sample event description',
      startDate: new Date(Date.now() + 86400000), // Tomorrow
      location: 'Conference Room A'
    };

    const result = await emailService.sendEventReminderEmail(user, event);

    res.json({
      success: true,
      messageId: result.MessageId,
      message: 'Event reminder sent successfully'
    });

  } catch (error) {
    console.error('Event reminder email error:', error);
    res.status(500).json({
      error: 'Failed to send event reminder',
      message: error.message
    });
  }
});

// POST /api/email/follower-notification - Send new follower notification
router.post('/follower-notification', authenticateToken, async (req, res) => {
  try {
    const { userId, followerId } = req.body;

    if (!userId || !followerId) {
      return res.status(400).json({ 
        error: 'User ID and follower ID are required' 
      });
    }

    const user = await User.findById(userId);
    const follower = await User.findById(followerId);

    if (!user || !follower) {
      return res.status(404).json({ error: 'User or follower not found' });
    }

    // Check if user wants follower notifications
    if (!user.emailNotifications?.followers) {
      return res.json({
        success: true,
        message: 'User has disabled follower notifications'
      });
    }

    const result = await emailService.sendNewFollowerEmail(user, follower);

    res.json({
      success: true,
      messageId: result.MessageId,
      message: 'Follower notification sent successfully'
    });

  } catch (error) {
    console.error('Follower notification email error:', error);
    res.status(500).json({
      error: 'Failed to send follower notification',
      message: error.message
    });
  }
});

// POST /api/email/weekly-digest - Send weekly digest to all users (admin only)
router.post('/weekly-digest', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get all users who have digest notifications enabled
    const users = await User.find({
      'emailNotifications.digest': true,
      isActive: { $ne: false }
    }).select('_id');

    const userIds = users.map(user => user._id.toString());
    
    if (userIds.length === 0) {
      return res.json({
        success: true,
        message: 'No users have digest notifications enabled',
        sent: 0
      });
    }

    const results = await emailService.sendWeeklyDigests(userIds);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: 'Weekly digest batch completed',
      sent: successful,
      failed,
      total: results.length,
      results
    });

  } catch (error) {
    console.error('Weekly digest error:', error);
    res.status(500).json({
      error: 'Failed to send weekly digest',
      message: error.message
    });
  }
});

// GET /api/email/status - Check SES configuration status
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const isConfigured = await checkSESConfiguration();
    const statistics = await getSendingStatistics();

    res.json({
      configured: isConfigured,
      statistics: statistics.SendDataPoints || [],
      quota: statistics.SendQuota || null
    });

  } catch (error) {
    console.error('Email status error:', error);
    res.status(500).json({
      error: 'Failed to get email status',
      message: error.message
    });
  }
});

// GET /api/email/statistics - Get email sending statistics (admin only)
router.get('/statistics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const statistics = await getSendingStatistics();

    const stats = {
      sendQuota: statistics.SendQuota,
      sentLast24Hours: statistics.SentLast24Hours,
      maxSendRate: statistics.MaxSendRate,
      dataPoints: statistics.SendDataPoints || []
    };

    res.json(stats);

  } catch (error) {
    console.error('Email statistics error:', error);
    res.status(500).json({
      error: 'Failed to get email statistics',
      message: error.message
    });
  }
});

// PUT /api/email/preferences - Update user email preferences
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const { 
      digest = true, 
      followers = true, 
      projects = true, 
      events = true, 
      messages = true 
    } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.emailNotifications = {
      digest,
      followers,
      projects,
      events,
      messages
    };

    await user.save();

    res.json({
      success: true,
      message: 'Email preferences updated successfully',
      preferences: user.emailNotifications
    });

  } catch (error) {
    console.error('Email preferences error:', error);
    res.status(500).json({
      error: 'Failed to update email preferences',
      message: error.message
    });
  }
});

// GET /api/email/preferences - Get user email preferences
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('emailNotifications');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const defaultPreferences = {
      digest: true,
      followers: true,
      projects: true,
      events: true,
      messages: true
    };

    res.json({
      preferences: user.emailNotifications || defaultPreferences
    });

  } catch (error) {
    console.error('Get email preferences error:', error);
    res.status(500).json({
      error: 'Failed to get email preferences',
      message: error.message
    });
  }
});

module.exports = router;
