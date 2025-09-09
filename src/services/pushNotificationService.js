const { 
  createPlatformEndpoint,
  sendPushNotification,
  sendTopicNotification,
  subscribeEndpointToTopic,
  unsubscribeFromTopic,
  deletePlatformEndpoint,
  getEndpointAttributes,
  setEndpointAttributes,
  sendBulkPushNotifications,
  PUSH_TEMPLATES
} = require('../config/sns');
const { queryItems, updateItem } = require('../config/dynamodb');
const User = require('../models/mongodb/User');

/**
 * Push notification service for handling all push notifications
 */
class PushNotificationService {
  constructor() {
    this.platformApplicationArn = process.env.SNS_PLATFORM_APPLICATION_ARN;
    this.topicArn = process.env.SNS_TOPIC_ARN;
    this.initialized = false;
    this.init();
  }

  /**
   * Initialize push notification service
   */
  async init() {
    try {
      if (!this.platformApplicationArn || !this.topicArn) {
        console.warn('SNS configuration incomplete - push notifications disabled');
        return;
      }
      
      this.initialized = true;
      console.log('Push notification service initialized');
    } catch (error) {
      console.error('Push notification service initialization failed:', error);
    }
  }

  /**
   * Register device for push notifications
   * @param {string} userId - User ID
   * @param {string} deviceToken - Device push token
   * @param {string} platform - Platform (ios/android)
   * @param {Object} deviceInfo - Additional device information
   * @returns {Promise<Object>} Registration result
   */
  async registerDevice(userId, deviceToken, platform = 'android', deviceInfo = {}) {
    try {
      if (!this.initialized) {
        throw new Error('Push notification service not initialized');
      }

      // Create platform endpoint
      const endpointResult = await createPlatformEndpoint(
        this.platformApplicationArn,
        deviceToken,
        { userId, platform, ...deviceInfo }
      );

      // Subscribe to general notifications topic
      const subscriptionResult = await subscribeEndpointToTopic(
        this.topicArn,
        endpointResult.EndpointArn
      );

      // Store device registration in DynamoDB
      const deviceRegistration = {
        userId,
        deviceToken,
        platform,
        endpointArn: endpointResult.EndpointArn,
        subscriptionArn: subscriptionResult.SubscriptionArn,
        deviceInfo,
        registeredAt: new Date().toISOString(),
        isActive: true
      };

      await updateItem(
        process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'networkx-notifications',
        { notificationId: `device_${userId}_${Date.now()}` },
        deviceRegistration
      );

      // Update user's push notification preferences
      await User.findByIdAndUpdate(userId, {
        $set: {
          'pushNotifications.enabled': true,
          'pushNotifications.deviceToken': deviceToken,
          'pushNotifications.platform': platform,
          'pushNotifications.endpointArn': endpointResult.EndpointArn
        }
      });

      return {
        success: true,
        endpointArn: endpointResult.EndpointArn,
        subscriptionArn: subscriptionResult.SubscriptionArn,
        message: 'Device registered for push notifications'
      };

    } catch (error) {
      console.error('Device registration error:', error);
      throw error;
    }
  }

  /**
   * Unregister device from push notifications
   * @param {string} userId - User ID
   * @param {string} endpointArn - SNS endpoint ARN
   * @returns {Promise<Object>} Unregistration result
   */
  async unregisterDevice(userId, endpointArn) {
    try {
      // Delete platform endpoint
      await deletePlatformEndpoint(endpointArn);

      // Update user's push notification preferences
      await User.findByIdAndUpdate(userId, {
        $set: {
          'pushNotifications.enabled': false,
          'pushNotifications.deviceToken': null,
          'pushNotifications.endpointArn': null
        }
      });

      return {
        success: true,
        message: 'Device unregistered from push notifications'
      };

    } catch (error) {
      console.error('Device unregistration error:', error);
      throw error;
    }
  }

  /**
   * Send push notification to specific user
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   * @param {string} notification.title - Notification title
   * @param {string} notification.body - Notification body
   * @param {Object} notification.data - Additional data
   * @returns {Promise<Object>} Send result
   */
  async sendToUser(userId, notification) {
    try {
      const user = await User.findById(userId).select('pushNotifications');
      
      if (!user?.pushNotifications?.enabled || !user.pushNotifications.endpointArn) {
        return {
          success: false,
          message: 'User does not have push notifications enabled'
        };
      }

      const result = await sendPushNotification(
        user.pushNotifications.endpointArn,
        notification,
        user.pushNotifications.platform
      );

      return {
        success: true,
        messageId: result.MessageId,
        message: 'Push notification sent successfully'
      };

    } catch (error) {
      console.error('Send to user error:', error);
      throw error;
    }
  }

  /**
   * Send push notification to multiple users
   * @param {Array<string>} userIds - Array of user IDs
   * @param {Object} notification - Notification data
   * @returns {Promise<Array>} Array of send results
   */
  async sendToUsers(userIds, notification) {
    try {
      const users = await User.find({
        _id: { $in: userIds },
        'pushNotifications.enabled': true,
        'pushNotifications.endpointArn': { $exists: true }
      }).select('pushNotifications');

      const endpointArns = users.map(user => user.pushNotifications.endpointArn);
      const platform = users[0]?.pushNotifications?.platform || 'android';

      const results = await sendBulkPushNotifications(endpointArns, notification, platform);

      return results;

    } catch (error) {
      console.error('Send to users error:', error);
      throw error;
    }
  }

  /**
   * Send broadcast notification to all users
   * @param {Object} notification - Notification data
   * @returns {Promise<Object>} Broadcast result
   */
  async sendBroadcast(notification) {
    try {
      if (!this.topicArn) {
        throw new Error('Topic ARN not configured');
      }

      const result = await sendTopicNotification(this.topicArn, notification);

      return {
        success: true,
        messageId: result.MessageId,
        message: 'Broadcast notification sent successfully'
      };

    } catch (error) {
      console.error('Broadcast notification error:', error);
      throw error;
    }
  }

  /**
   * Send new message notification
   * @param {string} recipientId - Recipient user ID
   * @param {Object} sender - Sender user data
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} Send result
   */
  async sendNewMessageNotification(recipientId, sender, messageData) {
    try {
      const notification = {
        title: PUSH_TEMPLATES.NEW_MESSAGE.title,
        body: PUSH_TEMPLATES.NEW_MESSAGE.body.replace('{{senderName}}', sender.firstName),
        data: {
          ...PUSH_TEMPLATES.NEW_MESSAGE.data,
          senderId: sender._id,
          messageId: messageData.messageId,
          conversationId: messageData.conversationId
        }
      };

      return await this.sendToUser(recipientId, notification);

    } catch (error) {
      console.error('New message notification error:', error);
      throw error;
    }
  }

  /**
   * Send new follower notification
   * @param {string} userId - User ID who gained a follower
   * @param {Object} follower - Follower user data
   * @returns {Promise<Object>} Send result
   */
  async sendNewFollowerNotification(userId, follower) {
    try {
      const notification = {
        title: PUSH_TEMPLATES.NEW_FOLLOWER.title,
        body: PUSH_TEMPLATES.NEW_FOLLOWER.body.replace('{{followerName}}', follower.firstName),
        data: {
          ...PUSH_TEMPLATES.NEW_FOLLOWER.data,
          followerId: follower._id,
          followerUsername: follower.username
        }
      };

      return await this.sendToUser(userId, notification);

    } catch (error) {
      console.error('New follower notification error:', error);
      throw error;
    }
  }

  /**
   * Send project invitation notification
   * @param {string} invitedUserId - Invited user ID
   * @param {Object} inviter - Inviter user data
   * @param {Object} project - Project data
   * @returns {Promise<Object>} Send result
   */
  async sendProjectInvitationNotification(invitedUserId, inviter, project) {
    try {
      const notification = {
        title: PUSH_TEMPLATES.PROJECT_INVITATION.title,
        body: PUSH_TEMPLATES.PROJECT_INVITATION.body
          .replace('{{inviterName}}', inviter.firstName)
          .replace('{{projectTitle}}', project.title),
        data: {
          ...PUSH_TEMPLATES.PROJECT_INVITATION.data,
          inviterId: inviter._id,
          projectId: project.projectId
        }
      };

      return await this.sendToUser(invitedUserId, notification);

    } catch (error) {
      console.error('Project invitation notification error:', error);
      throw error;
    }
  }

  /**
   * Send event reminder notification
   * @param {string} userId - User ID
   * @param {Object} event - Event data
   * @param {string} timeUntil - Time until event (e.g., "30 minutes")
   * @returns {Promise<Object>} Send result
   */
  async sendEventReminderNotification(userId, event, timeUntil) {
    try {
      const notification = {
        title: PUSH_TEMPLATES.EVENT_REMINDER.title,
        body: PUSH_TEMPLATES.EVENT_REMINDER.body
          .replace('{{eventTitle}}', event.title)
          .replace('{{timeUntil}}', timeUntil),
        data: {
          ...PUSH_TEMPLATES.EVENT_REMINDER.data,
          eventId: event.eventId
        }
      };

      return await this.sendToUser(userId, notification);

    } catch (error) {
      console.error('Event reminder notification error:', error);
      throw error;
    }
  }

  /**
   * Send post like notification
   * @param {string} postOwnerId - Post owner user ID
   * @param {Object} liker - User who liked the post
   * @param {Object} post - Post data
   * @returns {Promise<Object>} Send result
   */
  async sendPostLikeNotification(postOwnerId, liker, post) {
    try {
      const notification = {
        title: PUSH_TEMPLATES.POST_LIKE.title,
        body: PUSH_TEMPLATES.POST_LIKE.body.replace('{{likerName}}', liker.firstName),
        data: {
          ...PUSH_TEMPLATES.POST_LIKE.data,
          likerId: liker._id,
          postId: post.postId
        }
      };

      return await this.sendToUser(postOwnerId, notification);

    } catch (error) {
      console.error('Post like notification error:', error);
      throw error;
    }
  }

  /**
   * Send comment reply notification
   * @param {string} commentOwnerId - Comment owner user ID
   * @param {Object} replier - User who replied
   * @param {Object} comment - Comment data
   * @returns {Promise<Object>} Send result
   */
  async sendCommentReplyNotification(commentOwnerId, replier, comment) {
    try {
      const notification = {
        title: PUSH_TEMPLATES.COMMENT_REPLY.title,
        body: PUSH_TEMPLATES.COMMENT_REPLY.body.replace('{{replierName}}', replier.firstName),
        data: {
          ...PUSH_TEMPLATES.COMMENT_REPLY.data,
          replierId: replier._id,
          commentId: comment.commentId,
          postId: comment.postId
        }
      };

      return await this.sendToUser(commentOwnerId, notification);

    } catch (error) {
      console.error('Comment reply notification error:', error);
      throw error;
    }
  }

  /**
   * Update user's push notification preferences
   * @param {string} userId - User ID
   * @param {Object} preferences - Notification preferences
   * @returns {Promise<Object>} Update result
   */
  async updateNotificationPreferences(userId, preferences) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { 'pushNotifications.preferences': preferences } },
        { new: true }
      ).select('pushNotifications');

      return {
        success: true,
        preferences: user.pushNotifications.preferences,
        message: 'Push notification preferences updated'
      };

    } catch (error) {
      console.error('Update preferences error:', error);
      throw error;
    }
  }

  /**
   * Get user's push notification status
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Notification status
   */
  async getNotificationStatus(userId) {
    try {
      const user = await User.findById(userId).select('pushNotifications');
      
      if (!user) {
        throw new Error('User not found');
      }

      const status = {
        enabled: user.pushNotifications?.enabled || false,
        platform: user.pushNotifications?.platform || null,
        hasValidEndpoint: !!user.pushNotifications?.endpointArn,
        preferences: user.pushNotifications?.preferences || {
          messages: true,
          followers: true,
          projects: true,
          events: true,
          posts: true,
          comments: true
        }
      };

      return status;

    } catch (error) {
      console.error('Get notification status error:', error);
      throw error;
    }
  }
}

// Create singleton instance
const pushNotificationService = new PushNotificationService();

module.exports = pushNotificationService;
